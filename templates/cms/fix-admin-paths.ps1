# Run from: your-project\frontend
# This strips '/admin' prefix from router navigation paths (Link, navigate, isActive)
# It does NOT touch api.js apiRequest() calls — those are API endpoints

Write-Host "Fixing router paths for basename='/admin'..." -ForegroundColor Cyan

# --- AdminLayout.jsx ---
$file = "src/admin/AdminLayout.jsx"
$content = Get-Content $file -Raw
# Fix Link to="/admin/xxx" -> to="/xxx"
$content = $content -replace "to=""/admin/", 'to="/'
# Fix isActive('/admin/xxx') -> isActive('/xxx')
$content = $content -replace "isActive\('/admin/", "isActive('/"
Set-Content $file $content -NoNewline
Write-Host "  Fixed: $file" -ForegroundColor Green

# --- AdminContext.jsx ---
$file = "src/admin/AdminContext.jsx"
$content = Get-Content $file -Raw
# Fix navigate('/admin/login') -> navigate('/login')
$content = $content -replace "navigate\('/admin/", "navigate('/"
Set-Content $file $content -NoNewline
Write-Host "  Fixed: $file" -ForegroundColor Green

# --- CommandPalette.jsx ---
$file = "src/admin/CommandPalette.jsx"
$content = Get-Content $file -Raw
# Fix navigate('/admin/xxx') -> navigate('/xxx')
$content = $content -replace "navigate\('/admin/", "navigate('/"
# Fix to: '/admin/xxx' -> to: '/xxx'
$content = $content -replace "to: '/admin/", "to: '/"
Set-Content $file $content -NoNewline
Write-Host "  Fixed: $file" -ForegroundColor Green

# --- PageEditor.jsx ---
$file = "src/admin/PageEditor.jsx"
$content = Get-Content $file -Raw
# Fix to: '/admin/xxx' -> to: '/xxx'
$content = $content -replace "to: '/admin/", "to: '/"
# Fix to="/admin/xxx" -> to="/xxx"  (in case there are Link components too)
$content = $content -replace "to=""/admin/", 'to="/'
# Fix navigate('/admin/xxx') -> navigate('/xxx')
$content = $content -replace "navigate\('/admin/", "navigate('/"
Set-Content $file $content -NoNewline
Write-Host "  Fixed: $file" -ForegroundColor Green

Write-Host ""
Write-Host "Done! Now verify with:" -ForegroundColor Cyan
Write-Host '  Get-ChildItem -Path src/admin -Recurse -Include *.jsx | Select-String "navigate\(''/admin|to=""/admin|isActive\(''/admin"'
Write-Host ""
Write-Host "The only '/admin/' references remaining should be in api.js (API endpoints) and window.location.href" -ForegroundColor Yellow
