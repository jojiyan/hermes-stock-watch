const key=process.env.SCRAPINGANT_API_KEY;
if(!key)throw new Error("Missing key");
const url="https://www.hermes.com/us/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/";
const params=new URLSearchParams({url,browser:"false",proxy_country:"us",proxy_type:"datacenter",timeout:"50"});
const response=await fetch("https://api.scrapingant.com/v2/general?"+params,{headers:{"x-api-key":key}});
const html=await response.text();
const skuList=[...new Set([...html.matchAll(/id="grid-product-([A-Z0-9]+)"/g)].map(m=>m[1]))];
const samples=["H051551CKCM",...skuList.slice(0,4),...skuList.slice(15,18)];
const tiles=samples.map(sku=>{
 const i=html.indexOf('id="grid-product-'+sku+'"');
 const j=html.indexOf('id="grid-product-',i+10);
 const str=i<0?"":html.slice(i,Math.min(j>=0?j:i+15000,i+15000));
 const tag=str.match(/<h-out-of-stock-label[^>]*>[\s\S]{0,600}?<\/h-out-of-stock-label>/i)?.[0]||"";
 return {sku,tileSize:str.length,containsOutLabel:str.includes("h-out-of-stock-label"),outLabel:tag.slice(0,650),excerpt:str.slice(0,1200),text:str.replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,200)};
});
let stateInfo={};
const stateStr=html.match(/<script[^>]*id="hermes-state"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
if(stateStr){
 try{
   const data=JSON.parse(stateStr);
   const found=[];
   function walk(v,path,depth=0){
     if(found.length>30||depth>14||v==null||typeof v!=="object")return;
     if(Array.isArray(v)){for(let i=0;i<Math.min(v.length,300);i++)walk(v[i],path+"["+i+"]",depth+1);return;}
     const vjson=JSON.stringify(v).slice(0,2500);
     if(/H051551CKCM|H086422CK37/i.test(vjson) && vjson.length<2500){
       found.push({path,keys:Object.keys(v).slice(0,28),snippet:vjson.slice(0,900)});
     }
     for(const [k,x] of Object.entries(v))walk(x,path+"."+k,depth+1);
   }
   walk(data,"state");
   stateInfo={keys:Object.keys(data).slice(0,35),found,bytes:stateStr.length};
 }catch(e){stateInfo={error:e.message,bytes:stateStr.length,sample:stateStr.slice(0,150)};}
}
console.log(JSON.stringify({status:response.status,credits:response.headers.get("ant-credits-cost"),htmlLength:html.length,gridProductCount:skuList.length,tiles,stateInfo},null,2));
