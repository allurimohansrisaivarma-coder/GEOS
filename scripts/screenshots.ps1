# Regenerates the images used in the deck and README (needs Microsoft Edge and `npm start` running).
#   powershell -ExecutionPolicy Bypass -File scripts/screenshots.ps1
# If the server is not on port 5173, set SHOT_PORT first, for example:  $env:SHOT_PORT = "3000"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }
$port = if ($env:SHOT_PORT) { $env:SHOT_PORT } else { "5173" }
$base = "http://localhost:$port/?nosw=1&paused=1&anim=0"
$out = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\docs\img"))
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Shot($name, $query, $w, $h, $scale = 1) {
  $file = Join-Path $out "$name.png"
  if (Test-Path $file) { Remove-Item -LiteralPath $file -Force }
  if ($query -notmatch "theme=") { $query += "&theme=dark" }
  $url = "$base&$query"
  $args = @("--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=$scale", "--window-size=$w,$h", "--virtual-time-budget=9000", "--screenshot=$file", $url)
  Start-Process -FilePath $edge -ArgumentList $args -Wait -WindowStyle Hidden
  if (Test-Path $file) { "ok   $name  ($([int]((Get-Item $file).Length / 1KB)) KB)" } else { "FAIL $name" }
}

# full-page views (the floating simulation panel is part of the picture)
Shot "dashboard-warning"   "plant=jaisalmer&t=16&worker=arjun"                        1600 1000
Shot "dashboard-full"      "plant=jaisalmer&t=95&worker=arjun&truth=1"                1600 1650
Shot "offshore-full"       "plant=platformb&t=146&worker=deepak"                      1600 1000
Shot "notifications"       "plant=platformb&t=146&worker=deepak&notif=1"              1600 1000
Shot "live"                "plant=norilsk&mode=live&t=200&worker=irina"               1600 1000
Shot "mobile"              "plant=jaisalmer&t=60&worker=arjun&sim=min"                500  1500
Shot "benchmark"           "bench=1"                                                  1280 1100
Shot "how-it-works"        "how=1&theme=light"                                        1280 1100
# focused panels, captured narrow and at 2x so text stays legible when shown on a slide
Shot "pipeline"            "t=95&focus=pipeline"                                      1000 215  2
Shot "crew"                "t=95&focus=crew"                                          372  560  2
Shot "crew-vs-site"        "t=95&focus=crewsite"                                      720  560  2
Shot "chart-ignored"       "t=170&worker=arjun&truth=1&focus=chart"                   920  430  2
Shot "chart-followed"      "t=170&worker=arjun&truth=1&focus=chart&follow=1"          920  430  2
Shot "race"                "t=95&worker=kiran&truth=1&focus=race"                     920  330  2
Shot "gas-hero"            "plant=platformb&t=146&worker=deepak&focus=hero"           920  300  2
Shot "gas-site"            "plant=platformb&t=146&worker=deepak&focus=site"           400  760  2
