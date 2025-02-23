import { enableProdMode } from "@angular/core"
import { bootstrapApplication } from "@angular/platform-browser"

import { Application } from "./app.component.js"
import { appConfig } from "./config.js"
import { ENV, Environment } from "./environment"

if (ENV !== Environment.Development) {
    enableProdMode()
}

bootstrapApplication(Application, appConfig).catch(err => console.error(err))
