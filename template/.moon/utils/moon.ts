import fs from "node:fs"
import path from "node:path"

import { parse as parseYaml } from "yaml"

const IGNORES = ["node_modules", "dsit"]

export interface PackageQuery {
    language?: string
    folder?: string
}

export interface Package {
    id: string
    path: string
    configPath: string
    type: PackageType
    project: Project
}

export type PackageType = "application" | "library" | "configuration"

export interface Project {
    name: string
    description: string
    metadata?: Metadata
}

export interface Metadata {
    slug?: string
    [key: string]: any
}

export function packages(query: PackageQuery) {
    if (query.folder) {
        return byFolder(query.folder).sort(sortByPath)
    } else {
        return []
    }
}

function byFolder(folder: string): Package[] {
    if (!fs.existsSync(folder)) {
        return []
    }

    const result = []
    for (const entry of fs.readdirSync(folder)) {
        if (IGNORES.includes(entry)) {
            continue
        }

        const packagePath = path.join(folder, entry)
        const configPath = path.join(packagePath, "moon.yml")

        if (fs.existsSync(configPath)) {
            result.push(read(configPath, packagePath))
        }

        if (fs.statSync(packagePath).isDirectory()) {
            result.push(...byFolder(packagePath))
        }
    }
    return result
}

export function read(configPath: string, packagePath?: string): Package {
    packagePath ??= path.dirname(configPath)
    const config = parseYaml(fs.readFileSync(configPath, "utf-8"), { merge: true }) as Package
    return { ...config, path: packagePath, configPath }
}

export function isMoonConfig(path: string): boolean {
    return /(?:\\|\/)moon\.ya?ml$/.test(path)
}


function sortByPath(a: Package, b: Package) {
    return a.path.localeCompare(b.path)
}
