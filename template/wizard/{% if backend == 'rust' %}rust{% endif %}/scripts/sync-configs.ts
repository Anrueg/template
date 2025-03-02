import fs from "node:fs"
import path from "node:path"

import * as mkdirp from "mkdirp"
import { inline, parse as parseToml, Section, stringify as stringifyToml } from "@ltd/j-toml"
import { compose, moon, unixPath } from "@workspace/moon"
import { Document, Scalar, YAMLMap } from "yaml"

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
function updateToml(pkg: moon.Package, mutate: (cfg: CargoToml) => void) {
    const cargoPath = path.join(pkg.path, "Cargo.toml")
    if (!fs.existsSync(cargoPath)) {
        return
    }

    console.log(`update ${cargoPath}`)

    const content = parseToml(fs.readFileSync(cargoPath, "utf-8")) as CargoToml
    mutate(content)
    // const merged = merge(content, overrides)

    fs.writeFileSync(
        cargoPath,
        stringifyToml(content, { newline: "\n", newlineAround: "section", indent: "  ", forceInlineArraySpacing: 3 })
    )
}

function updateCompose(file: string, packages: moon.Package[]) {
    if (!fs.existsSync(file)) {
        return
    }

    const document = compose.load(file)
    const exists: string[] = []

    for (const pkg of packages) {
        if (pkg.type !== "application") {
            continue
        }

        const svcName = addService(document, pkg)
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
            kv.key instanceof Scalar &&
            kv.key.value !== "rust-builder" &&
            typeof kv.key.value === "string" &&
            !exists.includes(kv.key.value) &&
            kv.key.value.startsWith("rust-")
    )

    compose.save(document, file)
}

function addService(document: Document, pkg: moon.Package) {
    const svcName = pkg.project.metadata!.slug!

    document.setIn(["services", svcName, "build", "context"], ".")
    document.setIn(["services", svcName, "build", "dockerfile"], "docker/rust/Dockerfile.run")
    document.setIn(["services", svcName, "command"], pkg.project.name)
    document.setIn(["services", svcName, "restart"], "unless-stopped")

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
    document.setIn(["services", svcName, "build", "dockerfile"], "docker/rust/Dockerfile.build")
    document.setIn(["services", svcName, "build", "args", "PROFILE"], "$PROJECT_ENV")

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

function main() {
    const packages = moon.packages({ folder: "./rust" })
    const cargoToml = parseToml(fs.readFileSync("Cargo.toml", "utf-8")) as WorkspaceCargo
    const workspace = cargoToml.workspace

    for (const pkg of packages) {
        updateToml(pkg, config => {
            config.package ??= Section({})
            config.package["name"] = pkg.project.name
            // config.package["autolib"] ??= false
            // config.package["autobins"] ??= false

            for (const key of Object.keys(workspace.package ?? {})) {
                config.package[key] = inline({ workspace: true })
            }

            if (pkg.type === "application") {
                config.bin ??= []
                let section = config.bin.find(bin => bin["name"] === pkg.project.name)
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
                section["name"] = pkg.project.name
                section["path"] = "lib.rs"
                section["doctest"] = true
            }

            config.dependencies ??= Section({})
            for (const other of packages) {
                if (other.id === pkg.id || other.type !== "configuration") {
                    continue
                }

                config.dependencies[other.project.name] = inline({ path: unixPath(path.relative(pkg.path, other.id)) })
            }

            for (const key of Object.keys(workspace.dependencies ?? {})) {
                config.dependencies[key] = inline({ workspace: true })
            }

            config.lints ??= Section({ workspace: true })
        })
    }

    updateCompose("docker-compose.yml", packages)
}

main()
