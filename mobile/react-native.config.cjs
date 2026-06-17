// One overrides some react-native CLI commands so native iOS/Android builds go
// through One's pipeline (Metro mode here). Required for `one run:ios` /
// `one run:android` / `one prebuild`.
module.exports = {
  commands: [...require('one/react-native-commands')],
};
