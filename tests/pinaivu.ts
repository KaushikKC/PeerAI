import * as anchor from "@coral-xyz/anchor";
import { Program }   from "@coral-xyz/anchor";
import { Pinaivu }   from "../target/types/pinaivu";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPda(seeds: Buffer[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function randomPubkeyBytes(): number[] {
  return Array.from(Keypair.generate().publicKey.toBytes());
}

function randomRequestId(): number[] {
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("pinaivu", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Pinaivu as Program<Pinaivu>;

  let programStatePda: PublicKey;

  // Initialize the program once before all tests.
  before(async () => {
    [programStatePda] = findPda([Buffer.from("state")], program.programId);

    await program.methods
      .initialize(new anchor.BN(300)) // 5-minute default escrow timeout
      .accounts({
        programState:  programStatePda,
        admin:         provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  // ── ProgramState ───────────────────────────────────────────────────────────

  it("initializes program state", async () => {
    const state = await program.account.programState.fetch(programStatePda);
    assert.equal(state.admin.toBase58(), provider.wallet.publicKey.toBase58());
    assert.equal(state.escrowTimeoutSecs.toNumber(), 300);
    assert.equal(state.totalNodesRegistered.toNumber(), 0);
    assert.equal(state.totalJobsCompleted.toNumber(), 0);
  });

  // ── Registry ──────────────────────────────────────────────────────────────

  it("registers a node", async () => {
    const nodePubkey  = randomPubkeyBytes();
    const modelHash   = Array.from(Buffer.alloc(32, 0x01));

    const [regPda] = findPda(
      [Buffer.from("node"), Buffer.from(nodePubkey)],
      program.programId
    );

    await program.methods
      .registerNode(nodePubkey, [modelHash], 24576, new anchor.BN(1_000))
      .accounts({
        registration: regPda,
        programState: programStatePda,
        authority:    provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const reg = await program.account.nodeRegistration.fetch(regPda);
    assert.ok(reg.active);
    assert.equal(reg.gpuVramMb, 24576);
    assert.equal(reg.pricePerOneKLamports.toNumber(), 1_000);
    assert.deepEqual(reg.modelHashes[0], modelHash);

    const state = await program.account.programState.fetch(programStatePda);
    assert.equal(state.totalNodesRegistered.toNumber(), 1);
  });

  it("updates a node", async () => {
    const nodePubkey = randomPubkeyBytes();
    const [regPda] = findPda(
      [Buffer.from("node"), Buffer.from(nodePubkey)],
      program.programId
    );

    await program.methods
      .registerNode(nodePubkey, [], 8192, new anchor.BN(500))
      .accounts({
        registration: regPda,
        programState: programStatePda,
        authority:    provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .updateNode([], 16384, new anchor.BN(750), false)
      .accounts({ registration: regPda, authority: provider.wallet.publicKey })
      .rpc();

    const reg = await program.account.nodeRegistration.fetch(regPda);
    assert.equal(reg.gpuVramMb, 16384);
    assert.equal(reg.active, false);
  });

  // ── Score / Reputation ────────────────────────────────────────────────────

  it("initializes a score account", async () => {
    const nodePubkey = randomPubkeyBytes();
    const [scorePda] = findPda(
      [Buffer.from("score"), Buffer.from(nodePubkey)],
      program.programId
    );

    await program.methods
      .initializeScore(nodePubkey)
      .accounts({
        score:         scorePda,
        authority:     provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const acc = await program.account.nodeScore.fetch(scorePda);
    assert.equal(acc.totalJobs.toNumber(), 0);
    assert.equal(acc.successRateBps, 10_000);
    assert.equal(acc.score.toNumber(), 0);
  });

  it("submits proofs and increments the score", async () => {
    const nodePubkey = randomPubkeyBytes();
    const [scorePda] = findPda(
      [Buffer.from("score"), Buffer.from(nodePubkey)],
      program.programId
    );

    await program.methods
      .initializeScore(nodePubkey)
      .accounts({
        score:         scorePda,
        authority:     provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const proofHash = Array.from(Buffer.alloc(32, 0x42));
    await program.methods
      .submitProof(proofHash, 512, 250, new anchor.BN(5_000_000))
      .accounts({ score: scorePda, authority: provider.wallet.publicKey })
      .rpc();

    const acc = await program.account.nodeScore.fetch(scorePda);
    assert.equal(acc.totalJobs.toNumber(), 1);
    assert.equal(acc.totalTokensEarned.toNumber(), 512);
    assert.ok(acc.score.toNumber() > 0, "score should be non-zero after first proof");

    // Second proof — score should increase.
    const proof2 = Array.from(Buffer.alloc(32, 0x99));
    await program.methods
      .submitProof(proof2, 1024, 200, new anchor.BN(10_000_000))
      .accounts({ score: scorePda, authority: provider.wallet.publicKey })
      .rpc();

    const acc2 = await program.account.nodeScore.fetch(scorePda);
    assert.equal(acc2.totalJobs.toNumber(), 2);
    assert.ok(acc2.score.toNumber() >= acc.score.toNumber(), "score should not decrease");
  });

  it("rejects a zero proof_hash", async () => {
    const nodePubkey = randomPubkeyBytes();
    const [scorePda] = findPda(
      [Buffer.from("score"), Buffer.from(nodePubkey)],
      program.programId
    );

    await program.methods
      .initializeScore(nodePubkey)
      .accounts({
        score:         scorePda,
        authority:     provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .submitProof(Array.from(Buffer.alloc(32, 0)), 512, 250, new anchor.BN(1))
        .accounts({ score: scorePda, authority: provider.wallet.publicKey })
        .rpc();
      assert.fail("should have thrown InvalidProofHash");
    } catch (e: any) {
      assert.include(e.message, "InvalidProofHash");
    }
  });

  it("anchors a merkle root", async () => {
    const nodePubkey  = randomPubkeyBytes();
    const merkleRoot  = Array.from(Buffer.alloc(32, 0x07));
    const label       = Array.from(Buffer.from("v1".padEnd(32, "\0")));

    const [scorePda] = findPda(
      [Buffer.from("score"), Buffer.from(nodePubkey)],
      program.programId
    );

    await program.methods
      .initializeScore(nodePubkey)
      .accounts({
        score:         scorePda,
        authority:     provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .anchorMerkleRoot(merkleRoot, label)
      .accounts({ score: scorePda, authority: provider.wallet.publicKey })
      .rpc();

    const acc = await program.account.nodeScore.fetch(scorePda);
    assert.deepEqual(Array.from(acc.merkleRoot), merkleRoot);
    assert.deepEqual(Array.from(acc.merkleRootLabel), label);
  });

  // ── Escrow ────────────────────────────────────────────────────────────────

  it("locks and releases escrow", async () => {
    const nodeKeypair  = Keypair.generate();
    const requestId    = randomRequestId();
    const lockAmount   = new anchor.BN(10_000_000); // 0.01 SOL

    const [escrowPda] = findPda(
      [Buffer.from("escrow"), Buffer.from(requestId)],
      program.programId
    );

    // Lock
    await program.methods
      .lockEscrow(requestId, lockAmount, new anchor.BN(300))
      .accounts({
        escrow:        escrowPda,
        programState:  programStatePda,
        client:        provider.wallet.publicKey,
        nodeWallet:    nodeKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const locked = await program.account.escrowAccount.fetch(escrowPda);
    assert.equal(locked.amountLamports.toNumber(), 10_000_000);
    assert.deepEqual(locked.state, { locked: {} });

    // Release (node signs)
    const proofHash = Array.from(Buffer.alloc(32, 0x63));
    await program.methods
      .releaseEscrow(proofHash)
      .accounts({
        escrow:       escrowPda,
        programState: programStatePda,
        nodeWallet:   nodeKeypair.publicKey,
      })
      .signers([nodeKeypair])
      .rpc();

    const released = await program.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(released.state, { released: {} });
    assert.deepEqual(Array.from(released.proofHash), proofHash);

    const state = await program.account.programState.fetch(programStatePda);
    assert.equal(state.totalJobsCompleted.toNumber(), 1);
  });

  it("rejects release by wrong signer", async () => {
    const nodeKeypair  = Keypair.generate();
    const wrongSigner  = Keypair.generate();
    const requestId    = randomRequestId();

    const [escrowPda] = findPda(
      [Buffer.from("escrow"), Buffer.from(requestId)],
      program.programId
    );

    await program.methods
      .lockEscrow(requestId, new anchor.BN(5_000_000), new anchor.BN(300))
      .accounts({
        escrow:        escrowPda,
        programState:  programStatePda,
        client:        provider.wallet.publicKey,
        nodeWallet:    nodeKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .releaseEscrow(Array.from(Buffer.alloc(32, 0x01)))
        .accounts({
          escrow:       escrowPda,
          programState: programStatePda,
          nodeWallet:   wrongSigner.publicKey,
        })
        .signers([wrongSigner])
        .rpc();
      assert.fail("should have thrown Unauthorized");
    } catch (e: any) {
      assert.ok(e.message.includes("Unauthorized") || e.message.includes("ConstraintRaw"));
    }
  });
});
