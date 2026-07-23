// plotly.js-dist-min ships no bundled types; we use it loosely via this shim.
declare module 'plotly.js-dist-min' {
  const Plotly: any
  export default Plotly
}
