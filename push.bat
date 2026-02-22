@echo off
set /p comment="Enter commit message: "
git add .
git commit -m "%comment%"
git push
echo.
echo ================================
echo DONE! Code is on GitHub.
echo ================================
pause