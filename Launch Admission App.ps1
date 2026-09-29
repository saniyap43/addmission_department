$ErrorActionPreference = 'Stop'
$secure = Read-Host 'Choose a staff portal password (12+ characters)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ($password.Length -lt 12) { Write-Host 'Password must be at least 12 characters.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
$env:ADMIN_PASSWORD = $password
try {
  $server = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -PassThru
} catch { Write-Host 'Node.js 24 or newer is required. Install Node.js, then try again.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
Remove-Item Env:ADMIN_PASSWORD
Start-Sleep -Seconds 2
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 3
  Start-Process 'http://127.0.0.1:3000'
  Write-Host 'Admissions app opened in your browser.' -ForegroundColor Green
  Write-Host 'Sign in using the staff password you just chose.'
  Write-Host 'Keep the Node.js server window open while using the app. Close it to stop the server.'
} catch {
  Write-Host 'The app did not start at http://127.0.0.1:3000. Check the Node.js server window.' -ForegroundColor Red
}
Read-Host 'Press Enter to close this launcher'
