// Sample complaints for the demo, with the answer we expect (used by `npm run eval`).
export const SAMPLES = [
  {
    label: "Live wire near school",
    text: "There is a electric wire hanging very low and sparking near Govt Primary School, 4th Cross Malleshwaram. Kids walk here every morning!!",
    expect: { category: "electricity", severity: "Critical", department: "Power Distribution Utility – Emergency" },
  },
  {
    label: "Pothole (Kannada)",
    text: "ಹೆಬ್ಬಾಳ ಫ್ಲೈಓವರ್ ಹತ್ತಿರ ರಸ್ತೆಯಲ್ಲಿ ದೊಡ್ಡ ಗುಂಡಿ ಇದೆ, ನಿನ್ನೆ ರಾತ್ರಿ ಒಬ್ಬ ಬೈಕ್ ಸವಾರ ಬಿದ್ದರು.",
    expect: { category: "roads", severity: "High", department: "Roads & Infrastructure" },
  },
  {
    label: "Garbage (Hindi)",
    text: "हमारी गली में पाँच दिन से कचरा नहीं उठाया गया है, बहुत बदबू आ रही है और मच्छर बढ़ गए हैं। Near Indiranagar 12th Main.",
    expect: { category: "waste", severity: "High", department: "Solid Waste Management" },
  },
  {
    label: "Streetlight out",
    text: "Streetlight not working on 2nd Main Road, Jayanagar 4th Block for the past week. Street is dark and unsafe at night for women.",
    expect: { category: "electricity", severity: "High", department: "Electrical (Streetlights)" },
  },
  {
    label: "Burst pipe",
    text: "Water pipe burst near Koramangala BDA Complex, water gushing on the road since morning, wasting so much drinking water",
    expect: { category: "water", severity: "High", department: "Water Supply & Sewerage Board" },
  },
  {
    label: "Fallen tree",
    text: "A big tree fell during the rain last night at Sadashivanagar main road and is blocking the road completely",
    expect: { category: "trees", severity: "High", department: "Horticulture & Tree Cell" },
  },
  {
    label: "Open manhole",
    text: "Open manhole near City Hospital bus stop on MG Road, no cover since 2 days, very dangerous",
    expect: { category: "drainage", severity: "Critical", department: "Storm Water Drains" },
  },
  {
    label: "Faded zebra crossing",
    text: "Request to repaint the faded zebra crossing paint at Basavanagudi junction",
    expect: { category: "roads", severity: "Low", department: "Roads & Infrastructure" },
  },
  {
    label: "Vague (Hinglish)",
    text: "bhai yaha bahut problem hai koi kuch nahi kar raha",
    expect: { category: "other", severity: "Low", department: "Public Grievance Cell (manual review)" },
  },
  {
    label: "Duplicate of live wire",
    text: "Sparking wire hanging near the Govt Primary School, 4th Cross Malleshwaram, please send someone urgently",
    expect: { category: "electricity", severity: "Critical", department: "Power Distribution Utility – Emergency", duplicate: true },
  },
];
