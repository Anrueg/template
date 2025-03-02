import * as fs from "node:fs"
import * as path from "node:path"

import * as chokidar from "chokidar"
import * as mkdirp from "mkdirp"
import { Glob } from "bun"
import ignore from "ignore"
import { Minimatch } from "minimatch"

import * as moon from "./moon"
import { unixPath } from "./path"

// #region ConfigStore

interface ConfigFile<T> {
    path: string
    content: T
}

class ConfigStore<T> {
    readonly #cache = new Map<string, ConfigFile<T> | undefined>()

    constructor(
        readonly filename: string,
        readonly root: string,
        readonly parse: (path: string, parents: Array<ConfigFile<T>>) => T
    ) {}

    get(location: string): T | undefined {
        return this.#get(resolve(location))
    }

    #get(location: string): T | undefined {
        if (this.#cache.has(location)) {
            return this.#cache.get(location)?.content
        }

        const configs = this.#configPaths(location)
        if (configs.length === 0) {
            this.#cache.set(location, undefined)
            return undefined
        }

        const parents: Array<ConfigFile<T>> = []
        for (const conf of configs) {
            const parsed = this.#cache.get(conf) ?? { path: conf, content: this.parse(conf, parents.slice(0)) }
            this.#cache.set(conf, parsed)
            parents.push(parsed)
        }

        return parents[parents.length - 1].content
    }

    #configPaths(location: string): string[] {
        const configs: string[] = []
        try {
            if (fs.statSync(location).isFile()) {
                location = path.dirname(location)
            }
        } catch {}

        this.#find(location, configs)
        return configs
    }

    #find(dirPath: string, configs: string[]): void {
        if (path.relative(this.root, dirPath).startsWith("..")) {
            return
        }
        this.#find(path.dirname(dirPath), configs)

        const config = path.join(dirPath, this.filename)
        if (fs.existsSync(config)) {
            configs.push(config)
        }
    }

    del(location: string) {
        this.#del(resolve(location))
    }

    #del(location: string) {
        if (!location.endsWith(`${path.sep}${this.filename}`)) {
            return
        }

        this.#cache.delete(location)
        const dir = path.dirname(location)
        const remove = this.#cache.keys().filter(v => v.startsWith(dir))
        for (const entry of remove) {
            this.#del(entry)
        }
    }
}

class Gitignore extends ConfigStore<ignore.Ignore> {
    constructor(root: string) {
        super(".gitignore", root, (path, parents) => {
            const content = fs.readFileSync(path, "utf-8")
            const lines = content.split("\n").filter(line => !line.startsWith("#") && !/^\s*$/.exec(line))
            return ignore()
                .add(parents.map(v => v.content))
                .add(lines)
        })
    }
}

// class MoonConfigStore extends ConfigStore<MoonConfig> {
//     constructor(root: string) {
//         super("moon.yml", root, path => {
//             const content = fs.readFileSync(path, "utf-8")
//             return yaml.parse(content, { merge: true }) as MoonConfig
//         })
//     }
// }

// #endregion

// #region Utils
function resolve(loc: string): string {
    return unixPath(path.resolve(loc))
}

// #endregion

interface WatcherEvent {
    type: "add" | "change" | "unlink"
    path: string
}

interface WatchHandler {
    id: string
    pattern: Minimatch
    handler: (events: WatcherEvent[]) => void
}

interface MetadataWatcher {
    name: string
    globs?: string[] | string
    signal?: string
    task?: string
}

const MINIMATCH_OPTIONS = { dot: true, windowsPathsNoEscape: true }

class Watcher {
    readonly #gitignore: Gitignore
    // readonly #moon = new MoonConfigStore(this.workspace)
    readonly #moon = new Map<string, moon.Package>()
    readonly #handlers: WatchHandler[] = []

    constructor(readonly workspace: string) {
        this.#gitignore = new Gitignore(this.workspace)

        const moonFiles = new Glob("**/moon.yml")
        for (const file of moonFiles.scanSync(this.workspace)) {
            this.#onMoonConfigChange({ type: "add", path: file })
        }
    }

    async watch(debounceTime = 1000): Promise<void> {
        return new Promise(_resolve => {
            const watcher = chokidar.watch(this.workspace, {
                ignored: file => {
                    const relative = path.relative(this.workspace, file)
                    if (relative.length === 0) {
                        return false
                    }
                    const gitignore = this.#gitignore.get(file)
                    return !!gitignore?.ignores(relative)
                },
                cwd: this.workspace,
                ignoreInitial: true
            })

            const queue: WatcherEvent[] = []
            let timer: Timer | undefined
            const emit = (type: WatcherEvent["type"], path: WatcherEvent["path"]) => {
                if (moon.isMoonConfig(path)) {
                    this.#onMoonConfigChange({ type, path })
                }

                if (timer !== undefined) {
                    clearTimeout(timer)
                }
                queue.push({ type, path })
                timer = setTimeout(() => {
                    timer = undefined
                    const events = queue.splice(0, queue.length)
                    this.#execHandlers(events)
                }, debounceTime)
            }

            watcher
                .on("add", emit.bind(this, "add"))
                .on("change", emit.bind(this, "change"))
                .on("unlink", emit.bind(this, "unlink"))
                .on("error", err => console.log(err))
        })
    }

    #onMoonConfigChange(event: WatcherEvent): void {
        if (event.type === "unlink") {
            this.#moon.delete(event.path)
        } else {
            this.#moon.set(event.path, moon.read(event.path))
        }

        this.#handlers.length = 0
        for (const moon of this.#moon.values()) {
            this.#handlers.push(...this.#moonConfigToHandlers(moon))
        }
    }

    #moonConfigToHandlers(moon: moon.Package): WatchHandler[] {
        const metadata = moon.project.metadata
        if (metadata == null) {
            return []
        }

        const configs: Record<string, MetadataWatcher> = {}
        for (const [key, value] of Object.entries(metadata)) {
            const [watcher, name, property] = key.split(".")
            if (watcher !== "watcher") {
                continue
            }

            const config = (configs[name] ??= { name })
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            config[property as keyof MetadataWatcher] = value
        }

        const result: WatchHandler[] = []
        for (const config of Object.values(configs)) {
            const globs = config.globs
            if (globs == null || globs.length === 0) {
                console.error(`Missing globs in '${moon.configPath}' for watcher '${config.name}'`)
                continue
            }

            result.push(...this.#createWatchHandlers(moon, config))
        }

        return result
    }

    #createWatchHandlers(pkg: moon.Package, config: MetadataWatcher): WatchHandler[] {
        const result: WatchHandler[] = []
        const patterns = (Array.isArray(config.globs) ? config.globs : config.globs != null ? [config.globs] : []).map(
            glob => {
                if (glob.startsWith("/")) {
                    return new Minimatch(glob.slice(1), MINIMATCH_OPTIONS)
                } else {
                    return new Minimatch(path.join(pkg.path, glob), MINIMATCH_OPTIONS)
                }
            }
        )

        for (const pattern of patterns) {
            const signalFile = `.moon/cache/watcher/${unixPath(pkg.id)}/${config.name}.signal`
            result.push({
                id: `@signal(${signalFile})`,
                pattern,
                handler: () => {
                    const dir = path.dirname(signalFile)
                    mkdirp.sync(dir)
                    fs.writeFileSync(signalFile, "")
                }
            })

            if (config.task) {
                result.push({
                    id: `@task(${config.task})`,
                    pattern,
                    handler: () => {
                        console.error("TASK NOT IMPLEMENTED", config.name, config.task)
                    }
                })
            }
        }

        return result
    }

    #execHandlers(events: WatcherEvent[]): void {
        const handlers = this.#handlers.reduce<Record<string, { handler: WatchHandler; events: WatcherEvent[] }>>(
            (result, handler) => {
                const matched = events.filter(event =>
                    // console.log(handler.pattern.makeRe(), `./${event.path}`, handler.pattern.match(event.path))
                    handler.pattern.match(event.path)
                )
                if (matched.length > 0) {
                    result[handler.id] ??= { handler, events: [] }
                    result[handler.id].events.push(...matched)
                }
                return result
            },
            {}
        )

        for (const handler of Object.values(handlers)) {
            handler.handler.handler(handler.events)
        }
    }
}

async function watchTree(root: string): Promise<void> {
    const watcher = new Watcher(root)
    await watcher.watch(300)
}

await watchTree(process.cwd())
