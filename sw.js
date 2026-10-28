/* PLDS Household push service worker v1 */
self.addEventListener('push',event=>{
 let data={title:'PLDS Household',body:'A household activity changed.',url:'https://theplds.github.io/plds-household/'};
 try{if(event.data)data={...data,...event.data.json()}}catch(_){}
 event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag||'plds-change',icon:'./icon.svg',badge:'./icon.svg',data:{url:data.url}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const target=event.notification.data?.url||'https://theplds.github.io/plds-household/';
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  for(const window of windows){if(window.url.startsWith('https://theplds.github.io/plds-household/')){await window.focus();return;}}
  await clients.openWindow(target);
 })());
});