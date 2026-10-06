Write-Host "Auto-push service active. Checking for changes every 5 minutes..."
while ($true) {
    Start-Sleep -Seconds 300
    try {
        $status = git status --porcelain
        if ($status) {
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            Write-Host "[$timestamp] Changes detected. Committing and pushing..."
            git add -A
            git commit -m "Auto-update: $timestamp"
            git push origin main
            Write-Host "[$timestamp] Pushed successfully."
        }
    } catch {
        Write-Host "Error during auto-push: $_"
    }
}
