@echo off
echo PatchPilot Testing Environment Validation Script

REM Check that Jest is properly installed
echo Checking Jest installation...
call npx jest --version
if %ERRORLEVEL% NEQ 0 (
  echo Jest is not properly installed. Please run 'yarn add -D jest @types/jest ts-jest'
  exit /b 1
)

REM Create a simple test file to verify the setup
set TEMP_TEST_FILE=src\test\unit\setup-validation.test.ts
echo Creating temporary test file: %TEMP_TEST_FILE%

REM Create directories if they don't exist
if not exist src\test\unit mkdir src\test\unit

REM Create the test file
echo // Temporary test file to validate setup > %TEMP_TEST_FILE%
echo import * as vscode from 'vscode'; >> %TEMP_TEST_FILE%
echo. >> %TEMP_TEST_FILE%
echo describe('Test Setup Validation', () => { >> %TEMP_TEST_FILE%
echo   it('should have a working test environment', () => { >> %TEMP_TEST_FILE%
echo     expect(true).toBe(true); >> %TEMP_TEST_FILE%
echo   }); >> %TEMP_TEST_FILE%
echo. >> %TEMP_TEST_FILE%
echo   it('should mock vscode API correctly', () => { >> %TEMP_TEST_FILE%
echo     expect(vscode).toBeDefined(); >> %TEMP_TEST_FILE%
echo     expect(vscode.window).toBeDefined(); >> %TEMP_TEST_FILE%
echo     expect(vscode.window.showInformationMessage).toBeDefined(); >> %TEMP_TEST_FILE%
echo   }); >> %TEMP_TEST_FILE%
echo }); >> %TEMP_TEST_FILE%

REM Create a minimal jest config file if one doesn't exist
if not exist jest.config.js (
  echo Creating minimal jest.config.js...
  echo module.exports = { > jest.config.js
  echo   preset: 'ts-jest', >> jest.config.js
  echo   testEnvironment: 'node', >> jest.config.js
  echo   testMatch: ['**/*.test.ts'], >> jest.config.js
  echo   setupFilesAfterEnv: ['./src/test/setup/jest.setup.ts'], >> jest.config.js
  echo   transform: { >> jest.config.js
  echo     '^.+\\.tsx?$': ['ts-jest', { >> jest.config.js
  echo       tsconfig: 'tsconfig.json' >> jest.config.js
  echo     }] >> jest.config.js
  echo   } >> jest.config.js
  echo }; >> jest.config.js
)

REM Run the test with explicit args to ensure it's found
echo Running validation test...
call npx jest src\test\unit\setup-validation.test.ts --no-cache

set TEST_RESULT=%ERRORLEVEL%

REM Clean up
echo Cleaning up...
if %TEST_RESULT% EQU 0 (
  del "%TEMP_TEST_FILE%"
  echo Test setup validation passed! Your environment is ready for testing.
) else (
  echo Test setup validation failed. Please check the errors above.
  echo The test file is still at %TEMP_TEST_FILE% for inspection.
  exit /b 1
)