"""Generates migrations/0002_arcade_seed.sql (Season 01, initial funding commitment, quiz bank).
Correct answer is always listed first here; the server shuffles answers per attempt."""
import json, datetime
Q = [
 # HALLOWINU
 ("HALLOWINU","easy","What is HALLOWINU wearing in his official artwork?",["A white ghost hood","A witch hat","A vampire cape","A pumpkin helmet"]),
 ("HALLOWINU","easy","Which blockchain is $HALLOWINU built for?",["Solana","Ethereum","Bitcoin","Dogecoin"]),
 ("HALLOWINU","easy","What dog breed is HALLOWINU?",["Shiba Inu","Husky","Corgi","Poodle"]),
 ("HALLOWINU","easy","Complete the motto: \"No tricks. Just ___.\"",["Treats","Ghosts","Bones","Bats"]),
 ("HALLOWINU","medium","Where does the HALLOWINU community chat, raid and get launch announcements?",["Telegram","Discord","Reddit","Facebook"]),
 ("HALLOWINU","medium","Complete the slogan: \"Spooky season belongs to the ___.\"",["Inu","Cats","Witches","Bears"]),
 ("HALLOWINU","easy","What colour is HALLOWINU's fur?",["Orange","Grey","Black","Blue"]),
 ("HALLOWINU","medium","What is the name of the game section on hallowinu.xyz?",["HALLOWINU Arcade","Ghost Casino","Pumpkin Bank","Grave Exchange"]),
 # HALLOWEEN
 ("HALLOWEEN","easy","On what date is Halloween celebrated?",["October 31","October 13","November 1","September 30"]),
 ("HALLOWEEN","medium","Halloween's origins are often traced to which ancient Celtic festival?",["Samhain","Diwali","Hanukkah","Lammas"]),
 ("HALLOWEEN","easy","What is usually carved to make a jack-o'-lantern today?",["A pumpkin","A watermelon","An apple","A coconut"]),
 ("HALLOWEEN","hard","In Ireland and Scotland, jack-o'-lanterns were traditionally carved from which vegetable?",["Turnips","Carrots","Potatoes","Onions"]),
 ("HALLOWEEN","medium","\"All Hallows' Eve\" is the evening before which day?",["All Saints' Day","Christmas Day","New Year's Day","Easter Sunday"]),
 ("HALLOWEEN","easy","Which Mary Shelley novel features a famous man-made monster?",["Frankenstein","Dracula","The Invisible Man","Carmilla"]),
 ("HALLOWEEN","medium","Who wrote the novel Dracula?",["Bram Stoker","Edgar Allan Poe","Mary Shelley","H. P. Lovecraft"]),
 ("HALLOWEEN","easy","Bobbing for which fruit is a traditional Halloween game?",["Apples","Pears","Oranges","Plums"]),
 ("HALLOWEEN","medium","The old Scottish and Irish custom of \"guising\" is an ancestor of which Halloween tradition?",["Trick-or-treating","Carving turnips into boats","Fireworks night","Egg hunting"]),
 ("HALLOWEEN","hard","What is the name for a fear of Halloween?",["Samhainophobia","Arachnophobia","Coulrophobia","Nyctophobia"]),
 ("HALLOWEEN","easy","Which animal is classically linked to witches in Halloween folklore?",["Black cat","Golden retriever","Parrot","Rabbit"]),
 ("HALLOWEEN","easy","How many legs does a spider have?",["8","6","10","12"]),
 ("HALLOWEEN","medium","Mexico's Día de los Muertos is mainly celebrated on which dates?",["November 1–2","October 1–2","December 24–25","July 4–5"]),
 ("HALLOWEEN","hard","On which day did the escape artist Harry Houdini die in 1926?",["Halloween (October 31)","Christmas Day","New Year's Eve","Valentine's Day"]),
 ("HALLOWEEN","easy","Which flying mammal is a classic Halloween icon?",["The bat","The owl","The moth","The crow"]),
 # SOLANA BASICS
 ("SOLANA BASICS","easy","What is the native token of the Solana network?",["SOL","ETH","BNB","ADA"]),
 ("SOLANA BASICS","medium","What is the smallest unit of SOL called?",["Lamport","Satoshi","Wei","Gwei"]),
 ("SOLANA BASICS","hard","How many lamports make up 1 SOL?",["1,000,000,000","1,000,000","100,000,000","1,000"]),
 ("SOLANA BASICS","hard","The lamport is named after which computer scientist?",["Leslie Lamport","Alan Turing","Ada Lovelace","Grace Hopper"]),
 ("SOLANA BASICS","medium","Who wrote the original Solana whitepaper?",["Anatoly Yakovenko","Satoshi Nakamoto","Charles Hoskinson","Gavin Wood"]),
 ("SOLANA BASICS","medium","Solana's built-in clock mechanism is called Proof of ___.",["History","Work","Space","Burn"]),
 ("SOLANA BASICS","medium","What is the standard for fungible tokens on Solana called?",["SPL Token","ERC-20","BEP-20","TRC-20"]),
 ("SOLANA BASICS","easy","Which part of your Solana wallet is safe to share with others?",["Your public address","Your private key","Your seed phrase","Your wallet password"]),
 ("SOLANA BASICS","easy","In which token are Solana network transaction fees paid?",["SOL","BTC","USDT only","ETH"]),
 ("SOLANA BASICS","medium","In which year did Solana launch its mainnet beta?",["2020","2017","2015","2023"]),
 ("SOLANA BASICS","easy","Which of these is a popular Solana wallet?",["Phantom","Electrum","Bitcoin Core","Wasabi"]),
 ("SOLANA BASICS","medium","Which of these is a Solana block explorer?",["Solscan","Etherscan","BscScan","PolygonScan"]),
 ("SOLANA BASICS","medium","Solana programs (smart contracts) are most commonly written in which language?",["Rust","Solidity","PHP","COBOL"]),
 ("SOLANA BASICS","hard","What is the name of the popular framework for writing Solana programs?",["Anchor","Hardhat","Truffle","Foundry"]),
 # CRYPTO CULTURE
 ("CRYPTO CULTURE","medium","\"HODL\" started as a famous typo of which word?",["Hold","Hello","Hurdle","Hodge"]),
 ("CRYPTO CULTURE","easy","What does \"WAGMI\" stand for?",["We're All Gonna Make It","We Always Get More Income","Wallets Are Great, Mint It","Wait And Get More Info"]),
 ("CRYPTO CULTURE","easy","What does \"gm\" usually mean on crypto Twitter?",["Good morning","Good money","Great mint","Gas maximum"]),
 ("CRYPTO CULTURE","easy","What does \"DYOR\" stand for?",["Do Your Own Research","Don't Yell On Reddit","Double Your Own Returns","Delete Your Old Records"]),
 ("CRYPTO CULTURE","easy","What was the first cryptocurrency?",["Bitcoin","Ethereum","Dogecoin","Litecoin"]),
 ("CRYPTO CULTURE","easy","What is the name used by Bitcoin's pseudonymous creator?",["Satoshi Nakamoto","Vitalik Buterin","Hal Finney","Nick Szabo"]),
 ("CRYPTO CULTURE","hard","Bitcoin Pizza Day remembers 10,000 BTC being paid for two pizzas. On which date did that happen?",["May 22, 2010","January 3, 2009","October 31, 2008","July 4, 2012"]),
 ("CRYPTO CULTURE","easy","What does \"FUD\" stand for?",["Fear, Uncertainty and Doubt","Funds Under Deposit","Fully Unlocked Distribution","Fast Upload Daemon"]),
 ("CRYPTO CULTURE","easy","What does \"ATH\" mean?",["All-Time High","Average Token Holding","Automated Trading Hub","After The Halving"]),
 ("CRYPTO CULTURE","easy","In crypto slang, what is a \"whale\"?",["Someone holding a very large amount of a token","A new trader","A slow blockchain","A type of wallet app"]),
 ("CRYPTO CULTURE","easy","What is a DEX?",["A decentralized exchange","A digital ID card","A mining machine","A stablecoin"]),
 ("CRYPTO CULTURE","medium","Bitcoin's first block is often called what?",["The genesis block","The alpha block","The zero coin","The master block"]),
 # MEMECOIN CULTURE
 ("MEMECOIN CULTURE","easy","Which 2013 joke cryptocurrency used a Shiba Inu as its mascot?",["Dogecoin","Litecoin","Monero","Ripple"]),
 ("MEMECOIN CULTURE","hard","Who created Dogecoin?",["Billy Markus and Jackson Palmer","Satoshi Nakamoto","Vitalik Buterin and Gavin Wood","Charlie Lee"]),
 ("MEMECOIN CULTURE","hard","What was the name of the real Shiba Inu behind the \"Doge\" meme?",["Kabosu","Hachiko","Mochi","Shibu"]),
 ("MEMECOIN CULTURE","easy","Shiba Inu dogs originally come from which country?",["Japan","China","Korea","Thailand"]),
 ("MEMECOIN CULTURE","medium","What does \"inu\" mean in Japanese?",["Dog","Cat","Ghost","Moon"]),
 ("MEMECOIN CULTURE","easy","In memecoin chats, what does \"CA\" usually stand for?",["Contract address","Crypto account","Community admin","Coin amount"]),
 ("MEMECOIN CULTURE","easy","In memecoin communities, what is a \"raid\"?",["The community engaging together on a social post","A hack of the token contract","A sudden price crash","A wallet giveaway"]),
 ("MEMECOIN CULTURE","easy","What are your \"bags\" in memecoin slang?",["The tokens you hold","Your trading fees","Your unread messages","Your crypto bills"]),
 ("MEMECOIN CULTURE","easy","What does \"paper hands\" describe?",["Selling at the first sign of a dip","Holding forever","Buying with paper money","Trading only on weekends"]),
 ("MEMECOIN CULTURE","easy","What does \"rekt\" mean?",["Wrecked — a big loss","Recovered","Rejected by a DEX","Recorded on-chain"]),
 ("MEMECOIN CULTURE","medium","What is pump.fun mainly known for on Solana?",["Launching memecoins with a bonding curve","Mining SOL","Staking validators","Hosting NFTs only"]),
 ("MEMECOIN CULTURE","easy","What does \"LFG\" usually signal in a memecoin chat?",["Hype — \"let's go!\"","Low fee gas","Liquidity farm guide","Last free giveaway"]),
 # CRYPTO SAFETY
 ("CRYPTO SAFETY","easy","Should you ever share your seed phrase with anyone?",["Never — not even with \"support\"","Only with admins","Only in Telegram DMs","When promised an airdrop"]),
 ("CRYPTO SAFETY","easy","Someone DMs you as \"HALLOWINU support\" and asks for your seed phrase. What do you do?",["Ignore and report — the real team never asks","Send it quickly","Send half of it","Ask them to call you first"]),
 ("CRYPTO SAFETY","easy","A website asks you to \"validate your wallet\" by typing your private key. This is…",["A scam","Normal for airdrops","A required upgrade","A Solana rule"]),
 ("CRYPTO SAFETY","medium","Where should you get a token's contract address from?",["The project's official website and channels","A random reply under a post","Whoever DMs you first","A search engine ad"]),
 ("CRYPTO SAFETY","medium","What is the main job of a hardware wallet?",["Keeping private keys offline","Mining tokens","Making trades faster","Lowering network fees"]),
 ("CRYPTO SAFETY","medium","Phishing websites often…",["Copy real URLs with tiny typos","Always use .gov domains","Only appear on paper","Never ask for anything"]),
 ("CRYPTO SAFETY","hard","In a token swap, what is \"slippage\"?",["The difference between the expected and the executed price","A fee paid to validators","A failed transaction refund","A type of liquidity pool"]),
 ("CRYPTO SAFETY","medium","What is a \"rug pull\"?",["Developers abandoning a project and taking the funds","A sudden network upgrade","A wallet backup method","A community raid"]),
]
def esc(s): return s.replace("'", "''")
out=["-- Seed: Season 01, initial prize-pool commitment (PENDING until an admin verifies it), quiz bank.",
"-- Generated by tools/quiz_seed.py",""]
ts=int(datetime.datetime(2026,10,4,tzinfo=datetime.timezone.utc).timestamp()*1000)
start=ts; end=int(datetime.datetime(2026,11,1,tzinfo=datetime.timezone.utc).timestamp()*1000)
rules={"summary":"Top 10 season points share the verified prize pool. No purchase necessary. Points have no cash value.","dayBoundary":"00:00 UTC"}
out.append(f"INSERT INTO seasons (id,name,starts_at,ends_at,status,distribution_json,rules_json,created_at) VALUES ('s01','SEASON 01 — HALLOWINU ARCADE',{start},{end},'UPCOMING','[4000,2000,1200,800,600,400,300,300,200,200]','{esc(json.dumps(rules))}',{ts});")
out.append(f"INSERT INTO prize_pool_transactions (season_id,amount_lamports,source,status,notes,created_at,actor) VALUES ('s01',10000000000,'INITIAL_FUNDING','PENDING','Initial 10 SOL season commitment. Counts only after an admin verifies it.',{ts},'migration');")
out.append("")
for cat,diff,q,ans in Q:
    assert len(ans)==4 and len(set(ans))==4, q
    out.append(f"INSERT INTO quiz_questions (category,difficulty,question,answers_json,correct_index,active,created_at) VALUES ('{esc(cat)}','{diff}','{esc(q)}','{esc(json.dumps(ans, ensure_ascii=False))}',0,1,{ts});")
open('/home/claude/hallowinu-site/migrations/0002_arcade_seed.sql','w').write("\n".join(out)+"\n")
print(len(Q),'questions')
