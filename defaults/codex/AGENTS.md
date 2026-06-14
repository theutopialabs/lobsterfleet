## Writing style

For all comments, docstrings and any text you write in any project, follow these rules:

- Keep it short, simple, casual and informative
- No em dashes or semicolons
- Write so someone new to the project can grasp it fast
- Skip fancy words. Use the words you'd use talking to a coworker

Example:

// Bad
/// Initializes the connection pool by establishing a pre-configured
/// number of persistent connections, thereby mitigating latency
/// incurred during on-demand connection instantiation.

// Good
/// Opens a few connections up front so we don't pay the
/// connection cost on every request.
