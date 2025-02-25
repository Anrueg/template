import { enableProdMode } from "@angular/core"
import { bootstrapApplication } from "@angular/platform-browser"

import { ApplicationComponent } from "./app.component.js"
import { appConfig } from "./config.js"
import { ENV, Environment } from "./environment"

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (ENV !== Environment.Development) {
    enableProdMode()
}

bootstrapApplication(ApplicationComponent, appConfig).catch((err: unknown) => console.error(err))
