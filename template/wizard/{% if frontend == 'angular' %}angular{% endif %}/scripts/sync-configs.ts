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

interface TsconfigPaths {
    compilerOptions?: { paths?: Record<string, string[]> }
}

function tsconfigUpdatePaths(confPath: string, paths: Record<string, string>) {
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
    const packages = getPackages()

    updateAngularConfig(packages)
    tsconfigUpdatePaths(
        "tsconfig.base.json",
        packages.reduce<Record<string, string>>((dst, pkg) => {
            dst[`@${AngularNs}/${pkg.name}`] = `angular/${pkg.name}/public-api.ts`

            for (const mod of fs.readdirSync(pkg.path)) {
                const publicApi = path.join(pkg.path, mod, "public-api.ts")
                if (fs.existsSync(publicApi)) {
                    dst[`@${AngularNs}/${pkg.name}/${mod}`] = `angular/${pkg.name}/${mod}/public-api.ts`
                }
            }

            return dst
        }, {})
    )

    for (const pkg of packages) {
        // TODO: ng packager entrypoint
        tsconfigUpdatePaths(
            path.join(pkg.path, "tsconfig.cli.json"),
            packages
                .filter(v => v.config["projectType"] !== "application")
                .filter(v => v.name !== pkg.name)
                .reduce<Record<string, string>>((dst, pkg) => {
                    dst[`@${AngularNs}/${pkg.name}`] = `dist/angular/${pkg.name}`
                    return dst
                }, {})
        )
        // tsconfigUpdatePaths(path.join(pkg.path, "tsconfig.json"), {})
    }
}

main()
