// Single global namespace for the whole game. Loaded first.
// Using a global (instead of ES modules / fetch) keeps the game working over
// the file:// protocol with no build step and no local server. See WORKFLOW.md §0.
window.Solitaire = window.Solitaire || {};
