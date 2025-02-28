import fs from "node:fs"
import path from "node:path"

import { parse as parseYaml } from "yaml"

export interface ProjectQuery {
    language?: string
    folder?: string
}

export interface Project {
    id: string
    path: string
    type: ProjectType
    details: Details
}

export type ProjectType = "application" | "library" | "configuration"

export interface Details {
    name: string
    description: string
    metadata?: Metadata
}

export interface Metadata {
    ["signal-source"]: string
    ["signal-config"]: string
    folder?: string
    slug?: string
}

export function projects(query: ProjectQuery) {
    if (query.folder) {
        return byFolder(query.folder)
    } else {
        return []
    }
}

function byFolder(folder: string): Project[] {
    const result = []
    for (const entry of fs.readdirSync(folder)) {
        const projectPath = path.join(folder, entry)
        const configPath = path.join(projectPath, "moon.yml")

        if (fs.existsSync(configPath)) {
            const config = parseYaml(fs.readFileSync(configPath, "utf-8"), { merge: true }) as Project
            result.push({ ...config, details: (config as unknown as { project: Details }).project, path: projectPath })
        }
    }
    return result
}
