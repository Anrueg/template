import fs from "node:fs"
import path from "node:path"

import { parse } from "yaml"

import * as moon from "../../utils/moon"

const CopierConfig = parse(fs.readFileSync(".copier-answers.yml", "utf-8")) as Record<string, string>
const { frontend_toolchain: PackageManager, frontend_ns: AngularNs } = CopierConfig

interface AngularProject extends moon.Project {
    ngConfig: Record<string, any>
}

function getProjects(): AngularProject[] {
    const result: AngularProject[] = []

    for (const project of moon.projects({ folder: "./angular" })) {
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

function updateAngularConfig(packages: AngularProject[]) {
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
        result.projects[pkg.details.name] = pkg.ngConfig
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
    const packages = getProjects()

    updateAngularConfig(packages)
    tsconfigUpdatePaths(
        "tsconfig.base.json",
        packages.reduce<Record<string, string>>((dst, pkg) => {
            dst[`@${AngularNs}/${pkg.details.name}`] = `${pkg.path}/public-api.ts`

            for (const mod of fs.readdirSync(pkg.path)) {
                const publicApi = path.join(pkg.path, mod, "public-api.ts")
                if (fs.existsSync(publicApi)) {
                    dst[`@${AngularNs}/${pkg.details.name}/${mod}`] = `${pkg.path}/${mod}/public-api.ts`
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
                .filter(v => v.details.name !== pkg.details.name)
                .reduce<Record<string, string>>((dst, pkg) => {
                    dst[`@${AngularNs}/${pkg.details.name}`] = `dist/angular/${pkg.details.name}`
                    return dst
                }, {})
        )
        // tsconfigUpdatePaths(path.join(pkg.path, "tsconfig.json"), {})
    }
}

main()
