import fs from "node:fs"
import path from "node:path"

import { parse } from "yaml"

const CopierConfig = parse(fs.readFileSync(".copier-answers.yml", "utf-8")) as Record<string, string>
const { frontend_toolchain: PackageManager, frontend_ns: AngularNs } = CopierConfig

interface AngularPackage {
    name: string
    path: string
    config: Record<string, any>
}

function getPackages(): AngularPackage[] {
    const result: AngularPackage[] = []

    for (const folder of fs.readdirSync("./angular")) {
        const projectPath = path.join("./angular", folder)
        const configPath = path.join(projectPath, "ng-config.json")

        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, any>
            delete config["$schema"]
            result.push({
                name: folder,
                path: projectPath,
                config: config
            })
        }
    }

    return result
}

function updateAngularConfig(packages: AngularPackage[]) {
    const result = {
        $schema: "./node_modules/@angular/cli/lib/config/schema.json",
        version: 1,
        cli: {
            packageManager: PackageManager
        },
        newProjectRoot: "angular",
        projects: {} as Record<string, object>
    } as const

    for (const pkg of packages) {
        result.projects[pkg.name] = pkg.config
    }

    fs.writeFileSync("angular.json", JSON.stringify(result, null, 2))
}

function updateTsConfig(packages: AngularPackage[]) {
    const confPath = path.join("tsconfig.base.json")

    if (fs.existsSync(confPath)) {
        const conf = JSON.parse(fs.readFileSync(confPath, "utf-8")) as {
            compilerOptions?: { paths?: Record<string, string[]> }
        }
        if (!conf.compilerOptions) {
            conf.compilerOptions = {}
        }

        if (!conf.compilerOptions.paths) {
            conf.compilerOptions.paths = {}
        }

        for (const pkg of packages) {
            if (pkg.config["projectType"] === "application") {
                continue
            }

            conf.compilerOptions.paths[`@${AngularNs}/${pkg.name}`] = [`dist/angular/${pkg.name}`]
        }

        fs.writeFileSync(confPath, JSON.stringify(conf, null, 2))
    }
}

function main() {
    const packages = getPackages()

    updateAngularConfig(packages)
    updateTsConfig(packages)
}

main()
