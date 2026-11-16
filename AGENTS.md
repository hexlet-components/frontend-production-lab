# AGENTS.md

Репозиторий создан из шаблона `hexlet-components/component-template`. Шаблон ставит общий слой проверок из [dev-quality-gates](https://github.com/mokevnin/dev-quality-gates): mise, hk, commitlint, rumdl, typos, lychee, jactionlint и betterleaks. Проверки под стек репозитория шаблон не знает, их добавляет первая настройка.

## Стенд

Стенд курса `frontend_production_course` из hexlet-exercise-kit. Уроки цитируют его вывод: список файлов `npm run build`, имена и размеры ресурсов, ответы `curl -I`, сообщения Console. Правка _src/_, _vite.config.js_, _index.html_ или версии Vite меняет хеши и размеры в _dist/_, поэтому после неё вывод в уроках перепроверяется на новом стенде. Если студент застрял на примере урока, подсказку дают по этому стенду.

`package.json` студент видит в уроках, поэтому инструменты проверок стоят в `mise.toml`, а не в `devDependencies`.

## Проверки

`mise run check` и `mise run test` проходят до того, как правка считается сделанной. `test` собирает A и B во временном каталоге и проверяет публикацию, fallback, CORS, общий кеш, откат и отказ активации изменённого комплекта. `package-lock.json` правится только через npm. Правило линтера не отключают, чтобы провести правку: исключение узкое, с причиной и решением человека.
