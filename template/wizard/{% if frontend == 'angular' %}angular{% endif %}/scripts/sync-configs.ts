/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import fs from "node:fs"
import path from "node:path"

import { answers, moon, PortAssigner, unixPath } from "@workspace/moon"

const { frontend_toolchain: PackageManager, frontend_ns: AngularNs } = answers

interface AngularPackage extends moon.Package {
    ngConfig: Record<string, any>
}

function getPackages(): AngularPackage[] {
    const result: AngularPackage[] = []

    for (const project of moon.packages({ folder: "./angular" })) {
        const configPath = path.join(project.path, "ng-config.json")

        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, any>
            delete config["$schema"]
            result.push({
                ...project,
                ngConfig: config
            })
        }
    }

    return result
}

function updateAngularConfig(packages: AngularPackage[], portAssigner: PortAssigner) {
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
        const config = pkg.ngConfig
        config["architect"] ??= {}
        config["architect"].serve ??= {}
        config["architect"].serve.options ??= {}
        config["architect"].serve.options.port ??= portAssigner.next()
        result.projects[pkg.project.name] = pkg.ngConfig
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
    const packages = getPackages().sort((a, b) => a.id.localeCompare(b.id))
    const portAssigner = new PortAssigner(4200)

    updateAngularConfig(packages, portAssigner)
    tsconfigUpdatePaths(
        "tsconfig.base.json",
        packages.reduce<Record<string, string>>((dst, pkg) => {
            dst[`@${AngularNs}/${pkg.project.name}`] = unixPath(`${pkg.path}/public-api.ts`)

            for (const mod of fs.readdirSync(pkg.path)) {
                const publicApi = path.join(pkg.path, mod, "public-api.ts")
                if (fs.existsSync(publicApi)) {
                    dst[`@${AngularNs}/${pkg.project.name}/${mod}`] = unixPath(`${pkg.path}/${mod}/public-api.ts`)
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
                .filter(v => v.type !== "application")
                .filter(v => v.project.name !== pkg.project.name)
                .reduce<Record<string, string>>((dst, pkg) => {
                    dst[`@${AngularNs}/${pkg.project.name}`] = unixPath(`dist/${pkg.id}`)
                    return dst
                }, {})
        )
        // tsconfigUpdatePaths(path.join(pkg.path, "tsconfig.json"), {})
    }
}

main()
