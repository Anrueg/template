/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import fs from "node:fs"
import path from "node:path"

import { moon, unixPath } from "@workspace/moon"

interface StorybookPackage extends moon.Package {
    storybook: StorybookConfig
}

// TODO: https://github.com/storybookjs/storybook/issues/18405

interface StorybookConfig {
    path: string
    title: string
    port?: number
    url?: string
    open: boolean
}

function sync() {
    const pkgs = packages()
    syncRefs(pkgs)
}

function packages() {
    return [...angularPackages()]
}

function angularPackages(): StorybookPackage[] {
    if (!fs.existsSync("angular.json")) {
        return []
    }

    const angular = JSON.parse(fs.readFileSync("angular.json", "utf-8"))
    const projects = angular.projects

    return moon
        .packages({ folder: "./angular" })
        .filter(v => fs.existsSync(path.join(v.path, ".storybook")))
        .map(pkg => {
            const port = projects[pkg.project.name]?.architect?.storybook?.options?.port
            return {
                ...pkg,
                storybook: {
                    path: path.join(pkg.path, ".storybook"),
                    title: `Angular / ${pkg.project.name}`,
                    port: port,
                    url: port ? `http://localhost:${port}` : undefined
                }
            }
        })
}

function syncRefs(packages: StorybookPackage[]) {
    fs.writeFileSync(
        ".storybook/refs.json",
        JSON.stringify(refs(packages), null, 2),
        "utf-8"
    )
}

function refs(pkgs: StorybookPackage[], main: moon.Package) {
    return pkgs
        .filter(v => v !== main && v.storybook.port != null)
        .reduce<Record<string, object>>((res, pkg) => {
            res[unixPath(pkg.path)] = {
                title: pkg.storybook.title,
                url: pkg.storybook.url
            }
            return res
        }, {})
}

sync()
