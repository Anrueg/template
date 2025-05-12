# Trigger

```yml
tasks:
  build-deps: { script: "..." }
  build:
    command: next build
    deps: [~:build-deps]
    trigger:
      # runs only when command exited successfully
      success:
        # simple target reference
        - ~:triggered

      # runs only when command NOT exited successfully
      failure:
        # Extended target reference, just like deps + before / after porperty.
        # When need to run multiple tasks, thees two fields determine the order of tasks.
        # Not mandatory to executing tasks in theese properties, just define ordering.
        # (maybe implement before / after into deps as well)
        - target: ~:triggered
          args: --failed
          after: triggered2
          # So "triggered1" always run before "triggered3" but maybe another triggered task is executed in between
          before: triggered3
        - ~:triggered2

      # runs every time, when the command done
      any: [~:triggered5, ~:triggered3, ~:triggered4]

      # One idea for further possibilities
      # watch the running command output and if the given pattern found in text, runs the given tasks.
      # maybe can works in server / watcher mode, and can trigger tasks multiple times or strictly once.
      # good for chaining multiple watchers / servers together
      watchOutput:
        - match: "pattern to match"
          once: true
          tasks: []
  triggered: { script: "..." }
  triggered2: { script: "..." }
  triggered3: { script: "..." }
  triggered4: { script: "..." }
  triggered5: { script: "..." }
```

When the build command successfully exited, the following tasks are run:
`triggered`, `triggered5`, `triggered3`, `triggered4`
When the build command NOT successfully exited, the following tasks are run:
`triggered2`, `triggered`, `triggered5`, `triggered3`, `triggered4`


## Example for template generaton

```yml
tasks:
  add-lib:
    command: "moon generate ..."
    # TODO: maybe need a new property, like: template
    template:
      # the template name
      name: template-name
      # prefill template variables with thees values, and dont ask from user
      variables:
        preset: something
    trigger:
        success:
          - after-generate-success

        # One idea for further possibilities
        matchVariable:
          - variable: preset
            eq: something
            tasks: []

  after-generate-success:
    command: "..."
```
