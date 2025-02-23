import { argv } from "bun"

interface TaskDefinition {
    name: string
    on_success: string[]
    on_failure: string[]
}

async function main(taskDef: TaskDefinition) {
    try {
        await runTask(taskDef.name)
    } catch (mainExc: any) {
        if (taskDef.on_failure.length > 0) {
            try {
                await Promise.all(taskDef.on_failure.map(runTask))
            } catch (onFailExc: any) {
                process.exit(onFailExc.exitCode || 1)
            }
        }
        process.exit(mainExc.exitCode)
    }

    if (taskDef.on_success.length > 0) {
        try {
            await Promise.all(taskDef.on_success.map(runTask))
        } catch (onSuccessExc: any) {
            process.exit(onSuccessExc.exitCode || 1)
        }
    }
}

async function runTask(name: string) {
    const cmd = `moon run ${name}`
    return await Bun.$`${{ raw: cmd }}`.throws(true)
}

function parseTaskList(value: string): string[] {
    return value
        .split(/\s*,\s*/)
        .filter(Boolean)
        .map(taskQName)
}

function taskQName(task: string): string {
    const parts = task.split(":")
    if (parts.length === 1 || (parts.length === 2 && (parts[0] === "" || parts[0] === "~"))) {
        return `${process.env["MOON_PROJECT_ID"]}:${task}`
    }
    return task
}

const taskDef: TaskDefinition = {
    name: taskQName(argv[2]),
    on_success: parseTaskList(process.env["ON_SUCCESS"] || ""),
    on_failure: parseTaskList(process.env["ON_FAILURE"] || "")
}

if (!taskDef.name) {
    throw new Error("No task name provided")
}

await main(taskDef)
