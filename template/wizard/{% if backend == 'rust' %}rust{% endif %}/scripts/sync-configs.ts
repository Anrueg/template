import fs from "node:fs"
import path from "node:path"

import { inline, parse as parseToml, Section, stringify as stringifyToml } from "@ltd/j-toml"
import { Document, Scalar, YAMLMap } from "yaml"

import * as compose from "../../utils/docker-compose"
import * as moon from "../../utils/moon"

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
function updateToml(project: moon.Project, mutate: (cfg: CargoToml) => void) {
    const cargoPath = path.join(project.path, "Cargo.toml")
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

function updateCompose(file: string, projects: moon.Project[]) {
    if (!fs.existsSync(file)) {
        return
    }

    const document = compose.load(file)
    const exists: string[] = []

    for (const project of projects) {
        if (project.type !== "application") {
            continue
        }

        const svcName = addService(document, project)
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

function addService(document: Document, project: moon.Project) {
    const svcName = `rust-${project.details.metadata?.slug ?? project.id.split("/").join("-")}`

    document.setIn(["services", svcName, "build", "context"], ".")
    document.setIn(["services", svcName, "build", "dockerfile"], "docker/rust/Dockerfile.run")
    document.setIn(["services", svcName, "command"], svcName)

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

    const globalEnv = document.get("x-environment") as YAMLMap | null
    if (globalEnv != null) {
        compose.addMerge(document, ["services", svcName, "environment"], globalEnv)
    }

    compose.addVolumes(document, ["rust-binaries"])
    compose.addVolumeToService(document, svcName, "rust-binaries:/binaries:rw")
    compose.addVolumeToService(document, svcName, "./rust:/workspace/rust:ro")
    compose.addVolumeToService(document, svcName, "./.moon/cache/.changes/rust:/.changes:ro")
}

function main() {
    const projects = moon.projects({ folder: "./rust" })
    const cargoToml = parseToml(fs.readFileSync("Cargo.toml", "utf-8")) as WorkspaceCargo
    const workspace = cargoToml.workspace

    for (const project of projects) {
        updateToml(project, config => {
            config.package ??= Section({})
            config.package["name"] = project.details.name
            // config.package["autolib"] ??= false
            // config.package["autobins"] ??= false

            for (const key of Object.keys(workspace.package ?? {})) {
                config.package[key] = inline({ workspace: true })
            }

            if (project.type === "application") {
                config.bin ??= []
                let section = config.bin.find(bin => bin["name"] === project.details.name)
                if (section == null) {
                    section = Section({} as Record<string, any>)
                    config.bin.push(section)
                }
                section["name"] = project.details.name
                section["path"] = "main.rs"
                section["doctest"] = true
            }

            if (project.type === "library" || project.type === "configuration") {
                const section = (config.lib ??= Section({} as Record<string, any>))
                section["name"] = project.details.name
                section["path"] = "lib.rs"
                section["doctest"] = true
            }

            config.dependencies ??= Section({})
            for (const other of projects) {
                if (other.id === project.id || other.type !== "configuration") {
                    continue
                }
                const folder = other.details.metadata?.folder
                if (folder != null) {
                    config.dependencies[other.details.name] = inline({ path: `../${folder}` })
                }
            }

            for (const key of Object.keys(workspace.dependencies ?? {})) {
                config.dependencies[key] = inline({ workspace: true })
            }

            config.lints ??= Section({ workspace: true })
        })
    }

    updateCompose("docker-compose.yml", projects)
}

main()
