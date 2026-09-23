export const pageDefinitions = {
  Opportunities: {
    subtitle: 'Track business opportunities from first lead through negotiation and close.',
    columns: [
      ['name','Opportunity'],['commodity','Commodity'],['contact','Buyer / Contact'],['stage','Stage'],['value','Est. Value'],['nextAction','Next Action'],['due','Due Date']
    ],
    filterKey: 'stage',
    records: [
      {id:'opp-1',name:'Petroleum Coke Supply to Asia',commodity:'Petcoke',contact:'Yi Nan Wu',stage:'Negotiation',value:'$2.8M',nextAction:'Send COA',due:'Sep 25',business:'IrisTech',owner:'Michael',notes:'Buyer requires refinery profile and product specifications before POF sequencing.'},
      {id:'opp-2',name:'Lentils to India',commodity:'Red Lentils',contact:'Ashok Kanda',stage:'In Discussion',value:'$680K',nextAction:'Confirm specs',due:'Sep 28',business:'AgriCan',owner:'Ainu',notes:'Confirm grade, volume and delivery basis before pricing.'},
      {id:'opp-3',name:'Flax Seed to Pakistan',commodity:'Flax Seed',contact:'Irshad Ali Khokar',stage:'Contacted',value:'$210K',nextAction:'Send price list',due:'Sep 26',business:'AgriCan',owner:'Michael'},
      {id:'opp-4',name:'Chickpeas to UAE',commodity:'Chickpeas',contact:'First Mills',stage:'Research',value:'$1.1M',nextAction:'Find suppliers',due:'Oct 2',business:'AgriCan',owner:'Michael'},
      {id:'opp-5',name:'Canadian Gluten-Free Flour',commodity:'Flour (GF)',contact:'Middle East',stage:'Proposal Sent',value:'$450K',nextAction:'Follow up',due:'Sep 30',business:'AgriCan',owner:'Ainu'},
      {id:'opp-6',name:'Aluminum Initiative',commodity:'Aluminum',contact:'Confidential',stage:'On Hold',value:'—',nextAction:'Await feedback',due:'—',business:'IrisTech',owner:'Ainu'}
    ]
  },
  Projects: {
    subtitle: 'Manage initiatives, milestones and development work across the business group.',
    columns: [['name','Project'],['business','Business'],['status','Status'],['progress','Progress'],['target','Target Date']],
    filterKey:'status',
    records: [
      {id:'prj-1',name:'Edmonton Gluten-Free Flour Facility',business:'AgriCan',status:'In Progress',progress:'80%',target:'Dec 2026',owner:'Michael',notes:'Machinery comparison, facility assumptions and financial feasibility are being consolidated.'},
      {id:'prj-2',name:'Saskatchewan Resource Initiative',business:'IrisTech',status:'Planning',progress:'35%',target:'Mar 2027',owner:'Ainu'},
      {id:'prj-3',name:'IrisTech Website Development',business:'IrisTech',status:'In Progress',progress:'70%',target:'Sep 2026',owner:'Michael'},
      {id:'prj-4',name:'Healthcare Referral Funnel',business:'Partners',status:'In Progress',progress:'60%',target:'Nov 2026',owner:'Ainu'},
      {id:'prj-5',name:'Agricultural Export Development',business:'AgriCan',status:'In Progress',progress:'65%',target:'Dec 2026',owner:'Ainu'},
      {id:'prj-6',name:'Aluminum / Minerals Initiative',business:'IrisTech',status:'On Hold',progress:'20%',target:'TBD',owner:'Ainu'},
      {id:'prj-7',name:'Ogilvie Grain Limited Launch',business:'Ogilvie',status:'Planning',progress:'40%',target:'Sep 2026',owner:'Michael'}
    ]
  },
  Companies: {
    subtitle:'Organizations across buying, supply, consulting, logistics and partnership relationships.',
    columns:[['name','Company'],['type','Type'],['country','Country / Region'],['products','Products / Focus'],['status','Status']],
    filterKey:'type',
    records:[
      {id:'co-1',name:'First Mills',type:'Buyer',country:'Saudi Arabia',products:'Flour, Pulses',status:'Active',business:'AgriCan'},
      {id:'co-2',name:'Suncor Energy',type:'Supplier',country:'Alberta, Canada',products:'Petcoke',status:'Contacted',business:'IrisTech'},
      {id:'co-3',name:'My Future Canada',type:'Partner / Consultant',country:'Alberta, Canada',products:'Business & immigration referrals',status:'Active',business:'Partners'},
      {id:'co-4',name:'ELINK / HTW',type:'Buyer / Sourcing Partner',country:'China',products:'Industrial sourcing',status:'Active',business:'IrisTech'},
      {id:'co-5',name:'Richardson International',type:'Supplier',country:'Canada',products:'Grains, Oilseeds, Pulses',status:'Qualified',business:'AgriCan'},
      {id:'co-6',name:'Ogilvie Grain Limited',type:'Internal / Brokerage',country:'Saskatchewan, Canada',products:'Agricultural commodities',status:'Planning',business:'Ogilvie'}
    ]
  },
  Buyers: {
    subtitle:'Manage existing and prospective commodity buyers and their requirements.',
    columns:[['company','Company'],['contact','Contact'],['country','Country'],['products','Products'],['status','Status'],['lastContact','Last Contact']],
    filterKey:'status',
    records:[
      {id:'buy-1',company:'First Mills',contact:'Procurement Dept.',country:'Saudi Arabia',products:'Flour, Pulses',status:'Active',lastContact:'Sep 18, 2026',business:'AgriCan'},
      {id:'buy-2',company:'Al Rawabi Trading',contact:'Hassan Al-Mansoori',country:'UAE',products:'Lentils, Chickpeas',status:'Active',lastContact:'Sep 12, 2026',business:'AgriCan'},
      {id:'buy-3',company:'ELINK / HTW',contact:'Yi Nan Wu',country:'China',products:'Petcoke',status:'Active',lastContact:'Sep 10, 2026',business:'IrisTech'},
      {id:'buy-4',company:'Markinch Trading',contact:'Rajesh Kumar',country:'India',products:'Lentils, Flax',status:'In Discussion',lastContact:'Aug 26, 2026',business:'AgriCan'},
      {id:'buy-5',company:'Zakho Trading',contact:'Ali Hassan',country:'Iraq',products:'Flour, Grains',status:'Research',lastContact:'Aug 20, 2026',business:'AgriCan'},
      {id:'buy-6',company:'Anadolu Gıda',contact:'Mehmet Yılmaz',country:'Turkey',products:'Pulses, Grains',status:'New',lastContact:'Sep 15, 2026',business:'AgriCan'}
    ]
  },
  Suppliers: {
    subtitle:'Track sourcing options, qualification status and outstanding supplier information.',
    columns:[['company','Company'],['location','Location'],['products','Products'],['status','Status'],['notes','Notes']],
    filterKey:'status',
    records:[
      {id:'sup-1',company:'Suncor Energy',location:'Alberta, Canada',products:'Petcoke',status:'Contacted',notes:'COA requested',business:'IrisTech'},
      {id:'sup-2',company:'Canadian Natural',location:'Alberta, Canada',products:'Petcoke',status:'Research',notes:'Follow-up required',business:'IrisTech'},
      {id:'sup-3',company:'Prairie Grain Co.',location:'Saskatchewan',products:'Lentils, Peas',status:'Qualified',notes:'Pricing received',business:'AgriCan'},
      {id:'sup-4',company:'Nutrien Ag Solutions',location:'Saskatchewan',products:'Canary Seed, Pulses',status:'Contacted',notes:'Awaiting quote',business:'AgriCan'},
      {id:'sup-5',company:'Richardson International',location:'Manitoba',products:'Flax, Wheat',status:'Qualified',notes:'Good supply',business:'AgriCan'},
      {id:'sup-6',company:'Cargill Canada',location:'Multiple',products:'Grains, Oilseeds',status:'Active',notes:'Established',business:'AgriCan'}
    ]
  },
  Contacts: {
    subtitle:'Individual people within Ainu’s buyer, supplier, partner and advisor network.',
    columns:[['name','Name'],['company','Company'],['role','Role'],['category','Category'],['lastContact','Last Contact']],
    filterKey:'category',
    records:[
      {id:'con-1',name:'Ashok Kanda',company:'Markinch Trading',role:'Director',category:'Buyer',lastContact:'Sep 12, 2026',business:'AgriCan'},
      {id:'con-2',name:'Yi Nan Wu',company:'HTW / ELINK',role:'Representative | Industrial Sourcing',category:'Buyer / Partner',lastContact:'Sep 10, 2026',business:'IrisTech'},
      {id:'con-3',name:'Tim Gartner',company:'My Future Canada',role:'Consultant',category:'Partner / Referral',lastContact:'Sep 5, 2026',business:'Partners'},
      {id:'con-4',name:'Victor Muhia',company:'—',role:'Business Development',category:'Partner',lastContact:'Aug 28, 2026',business:'Partners'},
      {id:'con-5',name:'Rajesh Kumar',company:'Rajasthan Network',role:'Director',category:'Buyer',lastContact:'Aug 25, 2026',business:'AgriCan'},
      {id:'con-6',name:'Irshad Ali Khokar',company:'—',role:'Business Contact',category:'Supplier / Partner',lastContact:'Aug 20, 2026',business:'AgriCan'}
    ]
  },
  Commodities: {
    subtitle:'Internal commodity reference library for specifications, opportunities and indicative pricing.',
    columns:[['name','Commodity'],['category','Category'],['specs','Key Specs'],['price','Indicative Price'],['basis','Basis'],['opportunities','Opportunities']],
    filterKey:'category',
    records:[
      {id:'cmd-1',name:'Red Lentils',category:'Pulses',specs:'G2, clean',price:'$670/MT',basis:'Historical / supplier benchmark',opportunities:'4',business:'AgriCan'},
      {id:'cmd-2',name:'Green Lentils',category:'Pulses',specs:'Laird G2',price:'$693/MT',basis:'Historical / supplier benchmark',opportunities:'3',business:'AgriCan'},
      {id:'cmd-3',name:'Chickpeas',category:'Pulses',specs:'Kabuli, 9mm+',price:'$720/MT',basis:'Indicative',opportunities:'2',business:'AgriCan'},
      {id:'cmd-4',name:'Flax Seed',category:'Oilseeds',specs:'Food grade',price:'$780/MT',basis:'Indicative',opportunities:'3',business:'AgriCan'},
      {id:'cmd-5',name:'Canola Seed',category:'Oilseeds',specs:'#1 Canada',price:'$650/MT',basis:'Indicative',opportunities:'2',business:'AgriCan'},
      {id:'cmd-6',name:'Petcoke (Fuel Grade)',category:'Industrial',specs:'Buyer specs required',price:'$105/MT',basis:'Demo estimate',opportunities:'2',business:'IrisTech'},
      {id:'cmd-7',name:'Petcoke (Calcined)',category:'Industrial',specs:'Buyer specs required',price:'$215/MT',basis:'Demo estimate',opportunities:'2',business:'IrisTech'}
    ]
  },
  'Tasks & Follow-ups': {
    subtitle:'Manage execution, waiting states and items that specifically require Ainu’s decision.',
    columns:[['task','Task'],['related','Related To'],['priority','Priority'],['status','Status'],['due','Due Date']],
    filterKey:'status',
    records:[
      {id:'tsk-1',task:'Follow up with Suncor (COA)',related:'Petcoke Supply',priority:'High',status:'Waiting for Response',due:'Sep 25',business:'IrisTech',owner:'Michael'},
      {id:'tsk-2',task:'Review petcoke response sequencing',related:'Petcoke Supply',priority:'High',status:'Ainu Review',due:'Sep 24',business:'IrisTech',owner:'Ainu'},
      {id:'tsk-3',task:'Prepare handout for B2B Conference',related:'AgriCan',priority:'Medium',status:'In Progress',due:'Sep 26',business:'AgriCan',owner:'Michael'},
      {id:'tsk-4',task:'Email draft: Brown Flax to Yi Nan',related:'Flax Opportunity',priority:'Medium',status:'Not Started',due:'Sep 26',business:'AgriCan',owner:'Michael'},
      {id:'tsk-5',task:'Research Canadian Beef Suppliers',related:'New Opportunity',priority:'Low',status:'Not Started',due:'Sep 30',business:'AgriCan',owner:'Michael'},
      {id:'tsk-6',task:'Choose packaging equipment shortlist',related:'Flour Project',priority:'High',status:'Ainu Review',due:'Sep 29',business:'AgriCan',owner:'Ainu'},
      {id:'tsk-7',task:'Get quote for second bag former',related:'Flour Project',priority:'High',status:'In Progress',due:'Sep 28',business:'AgriCan',owner:'Michael'}
    ]
  },
  Meetings: {
    subtitle:'Schedule and review meetings, calls and internal project discussions.',
    columns:[['date','Date & Time'],['title','Title'],['participants','Participants'],['type','Type'],['location','Location']],
    filterKey:'type',
    records:[
      {id:'mtg-1',date:'Sep 24, 10:00 AM',title:'Supplier Call – Suncor',participants:'Ainu, Michael',type:'Supplier',location:'Teams',business:'IrisTech'},
      {id:'mtg-2',date:'Sep 25, 11:00 AM',title:'Call – Tim Gartner',participants:'Ainu, Tim',type:'Partner',location:'Phone',business:'Partners'},
      {id:'mtg-3',date:'Sep 28, 2:00 PM',title:'B2B Meeting – Grain Export',participants:'Ainu, Ashok Kanda',type:'Buyer',location:'Edmonton',business:'AgriCan'},
      {id:'mtg-4',date:'Sep 30, 1:00 PM',title:'Follow-up – Yi Nan',participants:'Ainu, Yi Nan',type:'Buyer',location:'WhatsApp',business:'IrisTech'},
      {id:'mtg-5',date:'Oct 1, 10:00 AM',title:'Internal Review – Flour Project',participants:'Ainu, Michael',type:'Internal',location:'Office',business:'AgriCan'}
    ]
  },
  Documents: {
    subtitle:'Prototype document index. Do not upload confidential files until authentication is added.',
    columns:[['name','Name'],['type','Type'],['related','Related To'],['date','Date Added'],['size','Size']],
    filterKey:'type',
    records:[
      {id:'doc-1',name:'Suncor Petcoke COA.pdf',type:'COA',related:'Petcoke Supply',date:'Sep 18, 2026',size:'1.2 MB',business:'IrisTech'},
      {id:'doc-2',name:'Machine Comparison.xlsx',type:'Research',related:'Flour Project',date:'Sep 10, 2026',size:'620 KB',business:'AgriCan'},
      {id:'doc-3',name:'Buyer Requirements – Yi Nan.pdf',type:'Specification',related:'Petcoke Supply',date:'Sep 5, 2026',size:'640 KB',business:'IrisTech'},
      {id:'doc-4',name:'AgriCan Company Profile.pdf',type:'Presentation',related:'AgriCan',date:'Aug 28, 2026',size:'2.1 MB',business:'AgriCan'},
      {id:'doc-5',name:'Meeting Notes – Ashok Kanda.docx',type:'Meeting Notes',related:'Lentils to India',date:'Aug 25, 2026',size:'320 KB',business:'AgriCan'},
      {id:'doc-6',name:'GACC Decree 280.pdf',type:'Regulatory',related:'Food Export',date:'Aug 20, 2026',size:'1.4 MB',business:'AgriCan'}
    ]
  },
  'Trade Leads': {
    subtitle:'Capture early inquiries before they become full opportunities.',
    columns:[['lead','Lead'],['source','Source'],['region','Region'],['product','Product'],['status','Status']],
    filterKey:'status',
    records:[
      {id:'lead-1',lead:'Canadian Beef Buyer',source:'Referral',region:'Pakistan',product:'Beef',status:'New',business:'AgriCan'},
      {id:'lead-2',lead:'Organic Wheat Inquiry',source:'B2B Event',region:'Turkey',product:'Wheat',status:'Research',business:'AgriCan'},
      {id:'lead-3',lead:'Pulse Importer',source:'Website',region:'UAE',product:'Lentils, Peas',status:'Research',business:'AgriCan'},
      {id:'lead-4',lead:'Animal Feed Ingredients',source:'Referral',region:'Egypt',product:'Canola, Flax',status:'New',business:'AgriCan'},
      {id:'lead-5',lead:'Edible Oil Distributor',source:'Conference',region:'India',product:'Canola Oil',status:'Archived',business:'AgriCan'}
    ]
  },
  'Partners & Referrals': {
    subtitle:'Track consultants, referral relationships, business partners and external networks.',
    columns:[['name','Name / Organization'],['interest','Relationship / Interest'],['status','Status'],['lastContact','Last Contact']],
    filterKey:'status',
    records:[
      {id:'par-1',name:'Tim Gartner / My Future Canada',interest:'Business referrals / immigration consulting',status:'Active',lastContact:'Sep 5, 2026',business:'Partners'},
      {id:'par-2',name:'Victor Muhia',interest:'Business Development / Partnerships',status:'Active',lastContact:'Aug 26, 2026',business:'Partners'},
      {id:'par-3',name:'Healthcare Worker Referrals',interest:'Alberta opportunities',status:'Research',lastContact:'Aug 20, 2026',business:'Partners'},
      {id:'par-4',name:'Pakistan Delegation',interest:'Business development',status:'In Discussion',lastContact:'Aug 15, 2026',business:'Partners'}
    ]
  },
  'Market Intelligence': {
    subtitle:'Source-aware internal price and market observations. Figures are demo or historical unless marked otherwise.',
    columns:[['commodity','Commodity'],['price','Price'],['basis','Basis'],['region','Region'],['source','Source'],['updated','Updated']],
    filterKey:'basis',
    records:[
      {id:'mkt-1',commodity:'Red Split Lentils',price:'US$670/MT',basis:'Historical purchase benchmark',region:'Canada',source:'GWC invoice / internal record',updated:'Jul 2026',business:'AgriCan'},
      {id:'mkt-2',commodity:'Large Green Lentils',price:'US$693/MT',basis:'Historical purchase benchmark',region:'Canada',source:'GWC invoice / internal record',updated:'Jul 2026',business:'AgriCan'},
      {id:'mkt-3',commodity:'Green Peas',price:'US$345/MT',basis:'Historical bulk benchmark',region:'Vancouver',source:'Internal historical record',updated:'Aug 2026',business:'AgriCan'},
      {id:'mkt-4',commodity:'Petcoke (Calcined)',price:'US$215/MT',basis:'Demo estimate',region:'Global',source:'Prototype only',updated:'Demo',business:'IrisTech'}
    ]
  },
  Reports: {
    subtitle:'Generate repeatable management views for pipeline, projects and operating activity.',
    columns:[['report','Report'],['scope','Scope'],['frequency','Frequency'],['lastGenerated','Last Generated']],
    records:[
      {id:'rep-1',report:'Opportunity Pipeline',scope:'All Businesses',frequency:'Weekly',lastGenerated:'Sep 20'},
      {id:'rep-2',report:'Project Status',scope:'Active Projects',frequency:'Weekly',lastGenerated:'Sep 20'},
      {id:'rep-3',report:'Contact Activity',scope:'CRM',frequency:'Monthly',lastGenerated:'Sep 1'},
      {id:'rep-4',report:'Market Summary',scope:'Commodities',frequency:'Weekly',lastGenerated:'Sep 19'}
    ]
  },
  Settings: {
    subtitle:'Prototype configuration and integration readiness.',
    columns:[['setting','Setting'],['description','Description'],['status','Status']],
    records:[
      {id:'set-1',setting:'User Management',description:'Roles & access permissions',status:'Prototype only'},
      {id:'set-2',setting:'Business Units',description:'AgriCan, IrisTech, Ogilvie, Partners',status:'Configured in demo'},
      {id:'set-3',setting:'Email Integration',description:'Connect business email',status:'Not Connected'},
      {id:'set-4',setting:'Notifications',description:'Alerts and reminders',status:'Demo only'},
      {id:'set-5',setting:'Data Export',description:'CSV and reports',status:'Planned'}
    ]
  },
  Profile: {
    subtitle:'Account profile used by the prototype.',
    columns:[['field','Field'],['value','Value']],
    records:[
      {id:'pro-1',field:'Name',value:'Ainu Azeem'},
      {id:'pro-2',field:'Role',value:'Business Development / Export Management'},
      {id:'pro-3',field:'Business Units',value:'AgriCan International Inc., IrisTech, Ogilvie / Partners'},
      {id:'pro-4',field:'Timezone',value:'Edmonton, Alberta'},
      {id:'pro-5',field:'Language',value:'English'}
    ]
  },
  'Help & Support': {
    subtitle:'Prototype help resources and implementation notes.',
    columns:[['resource','Resource'],['description','Description']],
    records:[
      {id:'help-1',resource:'User Guide',description:'Portal navigation and workflow guide'},
      {id:'help-2',resource:'Data Safety',description:'Do not enter confidential data until authentication and backend storage are implemented.'},
      {id:'help-3',resource:'Prototype Scope',description:'Search, filters, details and local demo records work in-browser; no shared database yet.'}
    ]
  }
};

export const businessUnits = ['All Businesses','AgriCan','IrisTech','Ogilvie','Partners'];
