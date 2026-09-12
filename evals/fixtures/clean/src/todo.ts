export function addTodo(todos: string[], title: string): string[] {
  if (title.trim() === '') return todos;
  return [...todos, title];
}
