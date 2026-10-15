// The single list of tabs. To add a feature, add one entry here and one folder under tabs/.
//
//   id        unique key (also used as a storage prefix by convention)
//   label     text on the tab button
//   enabled   false = shown greyed out as "coming soon"
//   load      () => import(...)  The module must default-export:
//               { async mount(rootElement, ctx) -> { activate(), deactivate() } }
//             It is only imported the first time the tab is opened.
export const TABS = [
  {
    id: "translate",
    label: "Translate",
    enabled: true,
    load: () => import("./translate/translate.js"),
  },
];
