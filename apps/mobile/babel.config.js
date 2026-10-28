module.exports = function (api) {
  api.cache(true)
  // babel-preset-expo (SDK 54) adds the Reanimated / Worklets plugin itself; listing it again is what SDK 52 needed.
  return { presets: ['babel-preset-expo'] }
}
