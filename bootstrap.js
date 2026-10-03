var chromeHandle;
var readTransScope;

async function startup({ rootURI }) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "readtrans", rootURI + "content/"],
  ]);
  readTransScope = { rootURI };
  Services.scriptloader.loadSubScript(
    rootURI + "content/scripts/readtrans.js",
    readTransScope,
  );
  await readTransScope.ReadTransPlugin.startup();
}

async function shutdown(_data, reason) {
  if (reason === APP_SHUTDOWN) return;
  await readTransScope?.ReadTransPlugin?.shutdown();
  chromeHandle?.destruct();
  chromeHandle = null;
  readTransScope = null;
}

function install() {}
function uninstall() {}
