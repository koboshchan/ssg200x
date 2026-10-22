// Disposable QA deployment only. A public flag alone can never enable mutations.
export function pokerKickDemoEnabled(env:Record<string,string|undefined>=process.env){
 return env.QA_GOOGLE_ADAPTER==='1'&&env.CLERK_SECRET_KEY?.startsWith('sk_test_')===true
  &&env.MONGODB_DB==='ssg_tables_qa'&&env.APP_ORIGIN==='https://warmly-vocally-versatile-cuckoo.kitten.space'
  &&/^mongodb:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(env.MONGODB_URI??'');
}
