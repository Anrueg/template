import { styleText } from "node:util"

import { argv, stderr, stdout } from "bun"

const [_bun, _script, serviceName] = argv
const cancel = new AbortController()

async function logs() {
    const logs = Bun.spawn(["docker", "compose", "logs", "--follow", "--no-log-prefix", serviceName], {
        cwd: process.cwd(),
        signal: cancel.signal,
        stdout: "inherit",
        stderr: "inherit"
    })
    await logs.exited
    await resetTerminal()
}

async function stop() {
    await Bun.$`docker compose stop ${serviceName}`.nothrow()
}

async function tearDown(exitCode: number) {
    cancel.abort()
    await stop()
    process.exit(exitCode)
}

async function resetTerminal() {
    await stdout.write(styleText(["reset"], ""))
    await stderr.write(styleText(["reset"], ""))
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
process.on("SIGINT", async () => {
    await tearDown(1)
})

await logs()
