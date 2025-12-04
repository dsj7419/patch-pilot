const { exec } = require('child_process');

// Получаем абсолютный путь к текущей папке
const cwd = process.cwd();

// Формируем команду с абсолютными путями. Кавычки нужны для путей с пробелами.
//const command = `code --disable-extensions --extensionDevelopmentPath="${cwd}" "${cwd}"`;
const command = `code --disable-extensions --extensionDevelopmentPath="${cwd}"`;


// Запускаем VS Code и не ждем его закрытия (fire and forget)
exec(command);
