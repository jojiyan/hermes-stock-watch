const key=process.env.SCRAPINGANT_API_KEY;
const url="https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/";
for(const suffix of ["","?page=2"]){
 const params=new URLSearchParams({url:url+suffix,browser:"false",proxy_country:"us",proxy_type:"datacenter",timeout:"50"});
 const r=await fetch("https://api.scrapingant.com/v2/general?"+params,{headers:{"x-api-key":key}});
 const html=await r.text();
 const script=html.match(/<script[^>]*id="hermes-state"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
 let meta={};
 if(script){
   const d=JSON.parse(script);
   const holder=Object.values(d).find(x=>Array.isArray(x?.b?.products?.items))?.b;
   const products=holder?.products||{};
   meta={bKeys:Object.keys(holder||{}).slice(0,50),productKeys:Object.keys(products),itemCount:products.items?.length,
      firstFive:products.items?.slice(0,5).map(x=>x.sku),lastFive:products.items?.slice(-5).map(x=>x.sku),
      values:Object.fromEntries(Object.entries(products).filter(([k,v])=>k!=="items"&&JSON.stringify(v).length<2000).slice(0,30))};
 }
 console.log(JSON.stringify({suffix,status:r.status,credits:r.headers.get("ant-credits-cost"),htmlLen:html.length,meta},null,2));
}
