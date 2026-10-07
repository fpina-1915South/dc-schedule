/* 1915 South DC Smart Scheduler: config
   Bump `version` every time app.js changes so browsers load the new copy. */
window.DC_CONFIG = {
  version: "1.12.0",

  // Paste the firebaseConfig from the DC Field App (project field-leader-1915).
  // Leave apiKey empty to run in DEMO mode (data saved only in this browser).
  firebase: {
    apiKey: "",
    authDomain: "field-leader-1915.firebaseapp.com",
    projectId: "field-leader-1915",
    storageBucket: "field-leader-1915.appspot.com",
    messagingSenderId: "",
    appId: ""
  },

  // Leave apiKey empty and the app borrows the config from the Field Leader App (same Firebase project).
  borrowConfigFrom: "https://fpina-1915south.github.io/field-leader-app/config.js",

  ownerEmail: "fpina@1915south.com",
  allowedDomain: "1915south.com",

  // Admins can edit settings and post for every DC. More can be added in Firestore config/access.admins
  admins: ["fpina@1915south.com", "acrawford@1915south.com"],

  // During testing any approved user can post any DC. Set false to limit posting
  // to admins plus the leaderEmails saved on each DC's Team tab.
  openPosting: false,

  appUrl: "https://fpina-1915south.github.io/dc-schedule/"
};
