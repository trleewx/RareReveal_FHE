pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract RareReveal_FHE is ZamaEthereumConfig {
    struct NFTData {
        string tokenURI;
        euint32 encryptedRarity;
        uint256 revealTimestamp;
        address owner;
        uint32 decryptedRarity;
        bool isRevealed;
    }

    mapping(uint256 => NFTData) public nftData;
    uint256[] public tokenIds;

    event NFTMinted(uint256 indexed tokenId, address indexed owner);
    event RarityRevealed(uint256 indexed tokenId, uint32 rarity);

    constructor() ZamaEthereumConfig() {}

    function mintNFT(
        uint256 tokenId,
        string calldata tokenURI,
        externalEuint32 encryptedRarity,
        bytes calldata inputProof
    ) external {
        require(nftData[tokenId].owner == address(0), "Token already exists");

        euint32 internalEncryptedRarity = FHE.fromExternal(encryptedRarity, inputProof);
        require(FHE.isInitialized(internalEncryptedRarity), "Invalid encrypted input");

        nftData[tokenId] = NFTData({
            tokenURI: tokenURI,
            encryptedRarity: internalEncryptedRarity,
            revealTimestamp: 0,
            owner: msg.sender,
            decryptedRarity: 0,
            isRevealed: false
        });

        FHE.allowThis(nftData[tokenId].encryptedRarity);
        FHE.makePubliclyDecryptable(nftData[tokenId].encryptedRarity);

        tokenIds.push(tokenId);
        emit NFTMinted(tokenId, msg.sender);
    }

    function revealRarity(
        uint256 tokenId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(nftData[tokenId].owner != address(0), "Token does not exist");
        require(!nftData[tokenId].isRevealed, "Rarity already revealed");
        require(msg.sender == nftData[tokenId].owner, "Only owner can reveal");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(nftData[tokenId].encryptedRarity);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 rarity = abi.decode(abiEncodedClearValue, (uint32));
        require(rarity > 0, "Invalid rarity value");

        nftData[tokenId].decryptedRarity = rarity;
        nftData[tokenId].isRevealed = true;
        nftData[tokenId].revealTimestamp = block.timestamp;

        emit RarityRevealed(tokenId, rarity);
    }

    function getEncryptedRarity(uint256 tokenId) external view returns (euint32) {
        require(nftData[tokenId].owner != address(0), "Token does not exist");
        return nftData[tokenId].encryptedRarity;
    }

    function getNFTData(uint256 tokenId) external view returns (
        string memory tokenURI,
        uint256 revealTimestamp,
        address owner,
        bool isRevealed,
        uint32 decryptedRarity
    ) {
        require(nftData[tokenId].owner != address(0), "Token does not exist");
        NFTData storage data = nftData[tokenId];

        return (
            data.tokenURI,
            data.revealTimestamp,
            data.owner,
            data.isRevealed,
            data.decryptedRarity
        );
    }

    function getAllTokenIds() external view returns (uint256[] memory) {
        return tokenIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

