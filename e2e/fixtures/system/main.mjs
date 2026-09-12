/**
 * The test system's whole job: exist, and register a setting of each scope.
 *
 * A world needs a system, and the check needs something to read and write that
 * is not the module itself. Two settings are enough for that: one shared by the
 * world, one held per browser.
 */
Hooks.once('init', () => {
  game.settings.register('settings-vault-fixture', 'schemaVersion', {
    name: 'Schema version',
    scope: 'world',
    config: false,
    type: String,
    default: '1.0.0',
  });

  game.settings.register('settings-vault-fixture', 'showTutorial', {
    name: 'Show the tutorial',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
});
