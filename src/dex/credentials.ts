import AdbWebCredentialStore from "@yume-chan/adb-credential-web";

/** One ADB key for every link, so a phone that trusted us over USB also trusts us over Wi-Fi. */
export const credentialStore = new AdbWebCredentialStore("MK-DEX");
