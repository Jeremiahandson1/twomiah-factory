// Feature catalog for the self-serve Features page. Deliberately lists ONLY the
// feature ids that something in this app actually gates (AdsPage → 'paid_ads',
// EstimatorPage → 'instant_estimator'). Listing un-consumed ids would give
// owners toggles that do nothing — the same dead-UI problem as a broken editor.
// When a new hasFeature() gate is added to the app, add its id here too.
export const FEATURE_CATEGORIES = [
  {
    id: 'addons',
    name: 'Optional Add-ons',
    description: 'Extra tools you can switch on — every feature is included in your plan',
    features: [
      { id: 'paid_ads', name: 'Paid Ads Dashboard', description: 'Track ad spend and the leads your campaigns bring in' },
      { id: 'instant_estimator', name: 'Instant Estimator', description: 'Let families get a ballpark care estimate online' },
    ],
  },
]
