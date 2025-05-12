/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import fs from "node:fs"
import path from "node:path"

import * as mkdirp from "mkdirp"
import { inline, parse as parseToml, Section, stringify as stringifyToml } from "@ltd/j-toml"
import { answers, compose, moon, PortAssigner, unixPath } from "@workspace/moon"
import { Document, Scalar, YAMLMap } from "yaml"

const { frontend_ns } = answers

interface WorkspaceCargo {
    workspace: CargoToml
    [key: string]: any
}

interface CargoToml {
    package?: Record<string, any>
    dependencies?: Dependencies
    lints?: Record<string, any>
    bin?: Array<Record<string, any>>
    lib?: Record<string, any>
    [key: string]: any
}

interface Dependency {
    workspace?: boolean
    version?: string
    features?: string[]
    path?: string
}

type Dependencies = Record<string, Dependency | string>

/*
[package]
version = { workspace = true }
edition = { workspace = true }

[dependencies]
dotenv = { workspace = true }
*/
function updateToml(cargoPath: string, mutate: (cfg: CargoToml) => void) {
    if (!fs.existsSync(cargoPath)) {
        return
    }

    const raw = fs.readFileSync(cargoPath, "utf-8").trim()
    const content = parseToml(raw) as CargoToml

    mutate(content)

    fs.writeFileSync(
        cargoPath,
        stringifyToml(content, { newline: "\n", newlineAround: "section", indent: "  ", forceInlineArraySpacing: 3 })
    )

    return content
}

function updateCompose(file: string, packages: moon.Package[], portAssigner: PortAssigner) {
    if (!fs.existsSync(file)) {
        return
    }

    const document = compose.load(file)
    const exists: string[] = []

    for (const pkg of packages) {
        if (pkg.type !== "application") {
            continue
        }

        const svcName = addService(document, pkg, portAssigner)
        if (!exists.includes(svcName)) {
            exists.push(svcName)
        }
    }

    if (exists.length > 0) {
        addBuilder(document)
    }

    compose.removeServices(
        document,
        kv =>
            kv.key instanceof Scalar
            && kv.key.value !== "rust-builder"
            && typeof kv.key.value === "string"
            && !exists.includes(kv.key.value)
            && kv.key.value.startsWith("rust-")
    )

    compose.save(document, file)
}

function addService(document: Document, pkg: moon.Package, portAssigner: PortAssigner) {
    const svcName = pkg.project.metadata!.slug!

    document.setIn(["services", svcName, "build", "context"], ".")
    document.setIn(["services", svcName, "build", "dockerfile"], "rust/.docker/Dockerfile.run")
    document.setIn(["services", svcName, "command"], pkg.project.name)

    compose.setPortmap(document, svcName, portAssigner.next(), 80)

    const globalEnv = document.get("x-environment") as YAMLMap | null
    if (globalEnv != null) {
        compose.addMerge(document, ["services", svcName, "environment"], globalEnv)
    }

    compose.addVolumes(document, ["rust-binaries", svcName])
    for (const volume of ["rust-binaries:/binaries:ro", `${svcName}:/data:rw`]) {
        compose.addVolumeToService(document, svcName, volume)
    }

    return svcName
}

function addBuilder(document: Document) {
    const svcName = "rust-builder"
    document.setIn(["services", svcName, "build", "context"], ".")
    document.setIn(["services", svcName, "build", "dockerfile"], "rust/.docker/Dockerfile.build")
    document.setIn(["services", svcName, "build", "args", "PROFILE"], "$ENVIRONMENT")

    const globalEnv = document.get("x-environment") as YAMLMap | null
    if (globalEnv != null) {
        compose.addMerge(document, ["services", svcName, "environment"], globalEnv)
    }

    mkdirp.sync("./.moon/cache/watcher/rust")

    compose.addVolumes(document, ["rust-binaries"])
    compose.addVolumeToService(document, svcName, "rust-binaries:/binaries:rw")
    compose.addVolumeToService(document, svcName, "./rust:/workspace/rust:ro")
    compose.addVolumeToService(document, svcName, "./.moon/cache/watcher/rust:/watcher:ro")
}

interface TsconfigPaths {
    compilerOptions?: { paths?: Record<string, string[]> }
}

function updateTSConfigPaths(confPath: string, paths: Record<string, string>) {
    if (fs.existsSync(confPath)) {
        const conf = JSON.parse(fs.readFileSync(confPath, "utf-8")) as TsconfigPaths
        conf.compilerOptions ??= { paths: {} }
        conf.compilerOptions.paths ??= {}

        for (const [alias, pth] of Object.entries(paths)) {
            const paths = (conf.compilerOptions.paths[alias] ??= [])
            if (!paths.includes(pth)) {
                paths.push(pth)
            }
        }

        fs.writeFileSync(confPath, JSON.stringify(conf, null, 2))
    }
}

function main() {
    const packages = moon.packages({ folder: "./rust" })
    const cargoToml: WorkspaceCargo = updateToml("Cargo.toml", (config: any) => {
        const wsdeps = config.workspace!.dependencies!

        for (const pkg of packages) {
            if (pkg.tags.includes("rust-wasm")) {
                continue
            }

            const pkgConf = parseToml(fs.readFileSync(path.join(pkg.path, "Cargo.toml"), "utf-8")) as CargoToml
            if (pkgConf.dependencies == null) {
                continue
            }

            for (const [k, v] of Object.entries(pkgConf.dependencies)) {
                if (typeof v === "string") {
                    wsdeps[k] ??= inline({ version: "*" })
                    continue
                }

                if (v.workspace != null || v.path != null) {
                    continue
                }

                wsdeps[k] ??= inline({ ...v, version: "*" })
            }
        }
    }) as any
    const workspace = cargoToml.workspace
    const wasmPaths: Record<string, string> = {}

    for (const pkg of packages) {
        updateToml(path.join(pkg.path, "Cargo.toml"), config => {
            config.package ??= Section({})
            config.package["name"] = pkg.project.name
            // config.package["autolib"] ??= false
            // config.package["autobins"] ??= false

            for (const key of Object.keys(workspace.package ?? {})) {
                config.package[key] = inline({ workspace: true })
            }

            if (pkg.type === "application") {
                config.bin ??= []
                let section = config.bin.find(bin => bin["path"] === "main.rs")
                if (section == null) {
                    section = Section({} as Record<string, any>)
                    config.bin.push(section)
                }
                section["name"] = pkg.project.name
                section["path"] = "main.rs"
                section["doctest"] = true
            }

            if (pkg.type === "library" || pkg.type === "configuration") {
                const section = (config.lib ??= Section({} as Record<string, any>))
                section["path"] = "lib.rs"
                section["doctest"] = true
            }

            // Update depencencies expect for rust-wasm
            if (!pkg.tags.includes("rust-wasm")) {
                config.dependencies ??= Section({})
                for (const other of packages) {
                    if (other.id === pkg.id || other.type !== "configuration") {
                        continue
                    }

                    config.dependencies[other.project.name] = inline({
                        path: unixPath(path.relative(pkg.path, other.id))
                    })
                }

                const deps: string[] = []
                for (const key of Object.keys(workspace.dependencies ?? {})) {
                    config.dependencies[key] = inline({ workspace: true })
                    deps.push(key)
                }

                const remove = Object.keys(config.dependencies).filter(dep => {
                    const value = config.dependencies![dep]
                    if (typeof value === "string") {
                        return false
                    }

                    if (value.workspace !== true) {
                        return false
                    }

                    return !deps.includes(dep)
                })

                for (const key of remove) {
                    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                    delete config.dependencies[key]
                }
            } else {
                wasmPaths[`@${frontend_ns}/${pkg.id}`] = unixPath(`dist/wasm/${pkg.id}`)
            }

            config.lints ??= Section({ workspace: true })
        })
    }

    const portAssigner = new PortAssigner(8000)
    updateCompose("docker-compose.yml", packages, portAssigner)
    updateTSConfigPaths("tsconfig.base.json", wasmPaths)

    moon.packages({ folder: "./angular" }).forEach(pkg => {
        updateTSConfigPaths(path.join(pkg.path, "tsconfig.cli.json"), wasmPaths)
    })
}

main()
