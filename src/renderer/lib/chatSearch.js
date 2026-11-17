// Searching the Claude Code chats list: by title and project folder.

/**
 * The chats matching a search. Case-insensitive; every word typed must appear
 * in the chat's title or its project folder, in any order. An empty search
 * matches everything.
 */
export function filterChats(chats, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return chats;
  return chats.filter((c) => {
    const text = `${c.title || 'Untitled chat'} ${c.cwd || ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
