/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as fs from "node:fs"

import * as yml from "yaml"
import { argv } from "bun"

const [_bun, _script, packageJson, scriptsYml] = argv

const pkg = JSON.parse(fs.readFileSync(packageJson, "utf-8"))
const scripts = yml.parse(fs.readFileSync(scriptsYml, "utf-8"), { merge: true })
pkg.scripts = {
    ...pkg.scripts,
    ...scripts
}
fs.writeFileSync(packageJson, JSON.stringify(pkg, null, 2) + "\n")
