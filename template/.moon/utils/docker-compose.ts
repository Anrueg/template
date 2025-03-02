import fs from "node:fs"

import { Alias, Document, Pair, parseDocument, Scalar, YAMLMap, YAMLSeq } from "yaml"

export function load(file: string) {
    return parseDocument(fs.readFileSync(file, "utf-8"))
}

export function save(document: Document, file: string) {
    fs.writeFileSync(file, document.toString({ lineWidth: 120 }))
}

export function addMerge(document: Document, path: string[], value: YAMLMap | YAMLSeq) {
    let envs = document.getIn(path) as YAMLMap | null

    if (envs == null) {
        envs = document.createNode({})
        document.setIn(path, envs)
        envs.add(document.createPair("<<", document.createAlias(value)))
    } else {
        const mergePair = envs.items.find(
            item => item instanceof Pair && item.key instanceof Scalar && item.key.value === "<<"
        )
        if (mergePair == null) {
            envs.items.splice(0, 0, document.createPair("<<", document.createAlias(value)))
        } else {
            if (mergePair.value instanceof Alias) {
                if (mergePair.value.source === value.anchor) {
                    return
                }

                const merges: YAMLSeq = document.createNode([])
                merges.add(mergePair.value)
                merges.add(document.createAlias(value))
                mergePair.value = merges
            } else if (mergePair.value instanceof YAMLSeq) {
                mergePair.value.flow = true

                const contains = mergePair.value.items.some(
                    item => item instanceof Alias && item.source === value.anchor
                )

                if (contains) {
                    return
                }

                mergePair.value.add(document.createAlias(value))
            }
        }
    }
}

export function addVolumes(document: Document, volumes: string[]) {
    let rootVols = document.get("volumes") as YAMLMap | null
    if (rootVols == null) {
        rootVols = document.createNode({})
        document.set("volumes", rootVols)
    }

    for (const v of volumes) {
        rootVols.set(v, null)
    }

    const allNull = rootVols.items.every(
        item =>
            item instanceof Pair && (item.value == null || (item.value instanceof Scalar && item.value.value == null))
    )

    rootVols.flow = allNull
}

export function addVolumeToService(document: Document, service: string, volume: string) {
    let volumes = document.getIn(["services", service, "volumes"]) as YAMLSeq<Scalar<string>> | null

    if (volumes == null) {
        volumes = document.createNode([])
        document.setIn(["services", service, "volumes"], volumes)
    }

    if (volumes.items.some(v => v.value === volume)) {
        return
    }

    volumes.add(document.createNode(volume))
}

export function removeServices(document: Document, test: (kv: Pair) => boolean) {
    const services = document.get("services") as YAMLMap | null
    if (services != null) {
        services.items = services.items.filter(kv => !test(kv))
    }
}
