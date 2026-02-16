# AI Coding Agent (LangGraph + Gemini)

Этот агент умеет автоматически создавать и редактировать Vue 3 компоненты.

## Стек
- **LangGraph**: Управление состоянием и логикой (Planner -> Executor).
- **Google Gemini 1.5 Flash**: LLM для планирования задач и генерации кода.
- **TypeScript**: Основной язык.

## Как запустить
1. Клонировать репозиторий.
2. `npm install`
3. Создать `.env` и добавить `GEMINI_API_KEY`.
4. `npx ts-node src/run.ts`
