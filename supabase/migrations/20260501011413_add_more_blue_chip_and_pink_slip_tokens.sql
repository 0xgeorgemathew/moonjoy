INSERT INTO public.token_universe_tokens (chain_id, address, symbol, name, decimals, risk_tier, source, metadata)
VALUES
  (8453, '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', 'DbcE', 'USDbC', 6, 'blue_chip', 'seed', '{}'),
  (8453, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 'DAI', 'Dai Stablecoin', 18, 'blue_chip', 'seed', '{}'),
  (8453, '0x6Bb750a640AEBce2D25e8C461E62e6436A7e2239', 'weETH', 'Wrapped eETH', 18, 'blue_chip', 'seed', '{}'),
  (8453, '0xE4B3B19F4E7400D97b85C0625eC9E2203aEc5387', 'TURBO', 'Turbo', 18, 'pink_slip', 'seed', '{}'),
  (8453, '0xaaaaaaaaaac56D681A1eB2b1F2af36B3F5e0B68a', 'MOG', 'Mog Coin', 18, 'pink_slip', 'seed', '{}')
ON CONFLICT DO NOTHING;
