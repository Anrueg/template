import { type StorybookConfig } from "@storybook/react-vite"
import { type StorybookConfigRaw } from "storybook/internal/types"
import { mergeConfig, type ProxyOptions } from "vite"

import refs from "./refs.json"

type Refs = NonNullable<StorybookConfigRaw["refs"]>
type Proxy = Record<string, ProxyOptions>

async function targetIsReachable(target: string): Promise<boolean> {
    // wait for 2 minutes before giving up
    for (let i = 0; i < 120; i++) {
        try {
            await fetch(target)
        } catch {
            await new Promise(r => setTimeout(r, 1000))
            continue
        }
        return true
    }
    return false
}

export default {
    framework: "@storybook/react-vite",
    stories: ["./**/*.mdx", "./**/*.stories.@(ts|tsx)", "./**/*.story.@(ts|tsx)"],
    core: { builder: "@storybook/builder-vite" },
    addons: ["@storybook/addon-essentials"],
    refs: (Object.keys(refs) as Array<keyof typeof refs>).reduce<Refs>((dst, key) => {
        dst[key] = { title: refs[key].title, url: `-/${key}`, expanded: true }
        return dst
    }, {}),
    viteFinal(config) {
        const proxy = (Object.keys(refs) as Array<keyof typeof refs>).reduce<Proxy>((dst, key) => {
            const prefix = `/-/${key}`
            const target = refs[key].url
            dst[prefix] = {
                target: target,
                rewrite: (path: string) => path.replace(new RegExp(`^${prefix}/`, "gi"), ""),
                bypass: () => targetIsReachable(target),
                proxyTimeout: 2 * 60 * 1000,
                timeout: 2 * 60 * 1000
            }
            return dst
        }, {})
        return mergeConfig(config, {
            server: {
                proxy,
                middlewareMode: true
            }
        })
    }
} satisfies StorybookConfig
