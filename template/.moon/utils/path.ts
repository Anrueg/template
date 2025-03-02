import path from "node:path"

export function unixPath(pth: string): string {
    return path.normalize(pth).replaceAll("\\", "/")
}
