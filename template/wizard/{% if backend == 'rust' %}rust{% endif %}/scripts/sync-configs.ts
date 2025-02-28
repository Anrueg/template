import fs from "node:fs"
import path from "node:path"

import { inline, parse as parseToml, Section, stringify as stringifyToml } from "@ltd/j-toml"
import { Document, parse as parseYaml, Scalar, YAMLMap, YAMLSeq } from "yaml"

import * as compose from "../../utils/docker-compose"

interface MoonProject {
    id: string
    path: string
    type: "application" | "library" | "configuration"
    lang: string
    project: MoonProjectDetails
    metadata: MoonProjectMetadata
}

interface MoonProjectMetadata {
    slug: string
    folder: string
    ["signal-source"]: string
    ["signal-config"]: string
}

interface MoonProjectDetails {
    name: string
}

function getProjects(): MoonProject[] {
    const result: MoonProject[] = []

    for (const folder of fs.readdirSync("./rust")) {
        const projectPath = path.join("./rust", folder)
        const configPath = path.join(projectPath, "moon.yml")

        if (fs.existsSync(configPath)) {
            const config = parseYaml(fs.readFileSync(configPath, "utf-8")) as MoonProject
            result.push({ ...config, path: projectPath })
        }
    }

    return result
}

interface WorkspaceCargo {
    workspace: CargoToml
    [key: string]: any
}

interface CargoToml {
    package?: Record<string, any>
    dependencies?: Dependencies
    lints?: Record<string, any>
    bin?: Record<string, any>[]
    lib?: Record<string, any>
    [key: string]: any
}

interface Dependency {
    workspace?: boolean
    version?: string
    features?: string[]
}

type Dependencies = Record<string, Dependency | string>

/*
[package]
version = { workspace = true }
edition = { workspace = true }

[dependencies]
dotenv = { workspace = true }
*/
function updateToml(project: MoonProject, mutate: (cfg: CargoToml) => void) {
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

function updateCompose(file: string, projects: MoonProject[]) {
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

function addService(document: Document, project: MoonProject) {
    const svcName = `rust-${project.metadata.slug}`

    document.setIn(["services", svcName, "build", "context"], ".")
    document.setIn(["services", svcName, "build", "dockerfile"], "docker/rust/Dockerfile.run")
    document.setIn(["services", svcName, "command"], svcName)

    const globalEnv = document.get("x-environment") as YAMLMap | null
    if (globalEnv != null) {
        compose.addMerge(document, ["services", svcName, "environment"], globalEnv)
    }

    compose.addVolumes(document, ["rust-binaries", svcName])
    for (const volume of ["rust-binaries:/binaries:ro", `${svcName}:/data:rw`]) {
        let volumes = document.getIn(["services", svcName, "volumes"]) as YAMLSeq<Scalar<string>> | null

        if (volumes == null) {
            volumes = document.createNode([])
            document.setIn(["services", svcName, "volumes"], volumes)
        }

        if (volumes.items.some(v => v.value === volume)) {
            continue
        }

        volumes.add(document.createNode(volume))
    }

    return svcName
}

function main() {
    const projects = getProjects()
    const cargoToml = parseToml(fs.readFileSync("Cargo.toml", "utf-8")) as WorkspaceCargo
    const workspace = cargoToml.workspace

    for (const project of projects) {
        updateToml(project, config => {
            config.package ??= Section({})
            config.package["name"] = project.project.name
            // config.package["autolib"] ??= false
            // config.package["autobins"] ??= false

            for (const key of Object.keys(workspace.package ?? {})) {
                config.package[key] = inline({ workspace: true })
            }

            if (project.type === "application") {
                config.bin ??= []
                let section = config.bin.find(bin => bin["name"] === project.project.name)
                if (section == null) {
                    section = Section({} as Record<string, any>)
                    config.bin.push(section)
                }
                section["name"] = project.project.name
                section["path"] = "main.rs"
                section["doctest"] = true
            }

            if (project.type === "library" || project.type === "configuration") {
                const section = (config.lib ??= Section({} as Record<string, any>))
                section["name"] = project.project.name
                section["path"] = "lib.rs"
                section["doctest"] = true
            }

            config.dependencies ??= Section({})
            for (const key of Object.keys(workspace.dependencies ?? {})) {
                config.dependencies[key] = inline({ workspace: true })
            }

            config.lints ??= Section({ workspace: true })
        })
    }

    updateCompose("docker-compose.yml", projects)
}

main()
