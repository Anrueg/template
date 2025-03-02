# Invoke-Repeat-Args <command> *-- --filter @globs(source-watch) --*

function Invoke-RepeatArgs {
    param ($Line)


    # $command, $arguments = Invoke-Expression ("Write-Output -- " + $Line)
    $command, $arguments = $Line

    $result = @()
    $repeatState = $null
    $repeatArg = $null
    foreach ($arg in $arguments) {

        if ($arg -eq "*--") {
            $repeatState = "begin"
        }
        elseif ($repeatState -eq "begin") {
            $repeatState = "has-arg"
            $repeatArg = $arg
        }
        elseif ($repeatState -eq "has-arg") {
            if ($arg -eq "--*") {
                $repeatState = "done"
                $repeatArg = $null
            }
            else {
                if ($repeatArg.EndsWith("=")) {
                    $result += "$repeatArg`"$arg`""
                }
                else {
                    $result += "$repeatArg `"$arg`""
                }
            }
        }
        else {
            $repeatState = $null
            $result += $arg
        }

        # Write-Output "'$arg' repeatState=$repeatState, repeatArg=$repeatArg"
    }

    Write-Output ($command + " " + ($result -join " "))
    return Invoke-Expression ($command + " " + ($result -join " "))
}

Invoke-RepeatArgs $args
