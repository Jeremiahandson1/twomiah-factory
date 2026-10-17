// Which trade a free-text business type reads as. ONE definition: buildSitePrompt uses it for the
// prompt's trade guidance and page recipes, composeSite for the pages it keeps. They used to be two
// hand-synced copies, and the copy in composeSite had no vet or RV branch — so a vet clinic's
// team page and a dealer's inventory and service pages were composed, then thrown away.
export function tradeFlagsFor(businessType: string) {
  const ft = /\b(food[_\s\-]?truck|mobile[_\s\-]?food|food[_\s\-]?cart|mobile[_\s\-]?kitchen|pop[_\s\-]?up[_\s\-]?kitchen)\b/i.test(businessType)
  const dispensary = /\b(dispensary|cannabis|cannabis[_\s\-]?retail)\b/i.test(businessType)
  const vet = /\b(vet|vets|veterinary|veterinarian|animal[_\s\-]?hospital|animal[_\s\-]?clinic|pet[_\s\-]?hospital|pet[_\s\-]?clinic|equine[_\s\-]?vet)\b/i.test(businessType)
  const rv = /\b(rv|rvs|motorhome|motor[_\s\-]?home|travel[_\s\-]?trailer|fifth[_\s\-]?wheel|camper|powersports|power[_\s\-]?sports|atv|utv|snowmobile|marine[_\s\-]?dealer|boat[_\s\-]?dealer|dealership)\b/i.test(businessType)
  const roofing = /\b(roofing|roof|roofer|storm[_\s\-]?restoration|siding[_\s\-]?roofing)\b/i.test(businessType)
  const landscaping = /\b(landscaping|lawn[_\s\-]?care|lawncare|landscape[_\s\-]?design|snow[_\s\-]?removal|tree[_\s\-]?service|arborist|hardscape)\b/i.test(businessType)
  const homecare = /\b(home[_\s\-]?care|homecare|in[_\s\-]?home[_\s\-]?care|senior[_\s\-]?care|caregiving|companion[_\s\-]?care|home[_\s\-]?health)\b/i.test(businessType)
  const fieldservice = /\b(field[_\s\-]?service|hvac|plumbing|plumber|electrical|electrician|appliance[_\s\-]?repair|cleaning|house[_\s\-]?cleaning|maid[_\s\-]?service|janitorial|commercial[_\s\-]?cleaning|pest[_\s\-]?control|exterminator|locksmith|garage[_\s\-]?door|septic|pool[_\s\-]?service|irrigation|handyman|painting|mobile[_\s\-]?detailing|mobile[_\s\-]?mechanic|pet[_\s\-]?grooming|dog[_\s\-]?walking)\b/i.test(businessType)
  const cafe = /\b(cafe|caf[eé]|coffee[_\s\-]?shop|coffeeshop|coffee[_\s\-]?house|tea[_\s\-]?room|tearoom|espresso[_\s\-]?bar|bakery[_\s\-]?caf[eé]?)\b/i.test(businessType)
  const restaurant = /\b(restaurant|bistro|gastropub|eatery|diner|pizzeria|trattoria|brasserie|taqueria|ramen[_\s\-]?shop|sushi[_\s\-]?bar)\b/i.test(businessType)
  const salon = /\b(salon|hair[_\s\-]?salon|hairdresser|barber|barbershop|nail[_\s\-]?salon|nail[_\s\-]?bar|spa|day[_\s\-]?spa|esthetician|esthetics|beauty[_\s\-]?salon|lash[_\s\-]?bar|brow[_\s\-]?bar|medspa|med[_\s\-]?spa|waxing)\b/i.test(businessType)
  // Bars — after cafe/restaurant/salon so "espresso bar", "sushi bar", "nail bar" keep their verticals;
  // juice/smoothie/oxygen/salad bars are excluded explicitly.
  const bar = /\b(tavern|pub|public[_\s\-]?house|saloon|taproom|tap[_\s\-]?room|brewpub|brew[_\s\-]?pub|brewery|beer[_\s\-]?garden|biergarten|speakeasy|supper[_\s\-]?club|(?<!juice[_\s\-])(?<!smoothie[_\s\-])(?<!oxygen[_\s\-])(?<!salad[_\s\-])bar)\b/i.test(businessType)
  const fitness = /\b(gym|fitness|fitness[_\s\-]?studio|yoga|yoga[_\s\-]?studio|pilates|pilates[_\s\-]?studio|crossfit|cross[_\s\-]?fit|boxing|boxing[_\s\-]?gym|martial[_\s\-]?arts|mma|personal[_\s\-]?training|personal[_\s\-]?trainer|spin[_\s\-]?studio|cycling[_\s\-]?studio|barre|dance[_\s\-]?studio)\b/i.test(businessType)
  const hotel = /\b(hotel|boutique[_\s\-]?hotel|b[_\s\-]?and[_\s\-]?b|b&b|bandb|bnb|bed[_\s\-]?and[_\s\-]?breakfast|inn|lodge|motel|vacation[_\s\-]?rental|short[_\s\-]?term[_\s\-]?rental|airbnb|guest[_\s\-]?house|cabin[_\s\-]?rental)\b/i.test(businessType)
  const events = /\b(event[_\s\-]?venue|wedding[_\s\-]?venue|banquet[_\s\-]?hall|banquet|venue|party[_\s\-]?venue|corporate[_\s\-]?venue|reception[_\s\-]?hall|barn[_\s\-]?venue|events)\b/i.test(businessType)
  // Contractor catches general contracting + the specific build-trade verticals.
  // Falls AFTER the others so a "kitchen" intake routes here, but a businessType
  // with the word "kitchen" in a cafe context ("kitchen cafe") routes to cafe.
  const contractor = /\b(contractor|general[_\s\-]?contractor|construction|remodeling|remodeler|siding|home[_\s\-]?improvement|kitchen|kitchen[_\s\-]?remodeling|kitchen[_\s\-]?design|kitchen[_\s\-]?installation|bath[_\s\-]?remodeling|bathroom[_\s\-]?remodeling|deck[_\s\-]?builder|fence[_\s\-]?installation|drywall|flooring|framing|concrete|masonry|tile[_\s\-]?installer|cabinet[_\s\-]?maker)\b/i.test(businessType)
  // Store LAST among the specific matchers (before contractor/generic): the
  // trade verticals above already claim "coffee shop"→cafe, "barbershop"→salon,
  // "vape shop"→store is fine. Catches dropshipping / e-commerce / online store.
  const store = /\b(store|shop|dropship|dropshipping|drop[_\s\-]?ship|e-?commerce|ecommerce|online[_\s\-]?store|online[_\s\-]?shop|retail|boutique|apparel|merch|goods|marketplace)\b/i.test(businessType)
  return { ft, dispensary, vet, rv, roofing, landscaping, homecare, fieldservice, cafe, restaurant, salon, bar, fitness, hotel, events, contractor, store }
}
